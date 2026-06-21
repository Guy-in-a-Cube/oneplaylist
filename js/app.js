/* ============================================
   OnePlaylist — App (Routing, Views, Library)
   ============================================ */

const App = (() => {
  let library = null;
  let currentView = 'home';

  // Fetch library data
  async function loadLibrary() {
    try {
      const response = await fetch('library.json');
      if (!response.ok) throw new Error('Failed to load library');
      library = await response.json();
      return library;
    } catch (err) {
      console.error('Error loading library:', err);
      document.getElementById('view-container').innerHTML = `
        <div class="view-header">
          <h2>Error</h2>
          <p>Could not load music library. Make sure library.json exists.</p>
        </div>`;
      return null;
    }
  }

  // Get library data
  function getLibrary() {
    return library;
  }

  // Router
  function initRouter() {
    window.addEventListener('hashchange', handleRoute);
    handleRoute();
  }

  function handleRoute() {
    const hash = window.location.hash || '#/';
    const container = document.getElementById('view-container');

    // Parse route
    if (hash.startsWith('#/album/')) {
      const path = hash.replace('#/album/', '');
      const parts = path.split('/');
      const slug = parts[0];
      const trackNum = parts[1] ? parseInt(parts[1]) : null;
      renderAlbumDetail(container, slug, trackNum);
    } else if (hash === '#/shuffle') {
      renderShuffle(container);
    } else if (hash === '#/about') {
      renderAbout(container);
    } else {
      renderHome(container);
    }

    // Update active nav link
    document.querySelectorAll('.nav-link, .topbar-link').forEach(link => {
      link.classList.remove('active');
      if (link.getAttribute('href') === hash ||
          (hash === '#/' && link.getAttribute('data-view') === 'home') ||
          (hash === '' && link.getAttribute('data-view') === 'home')) {
        link.classList.add('active');
      }
    });

    // Close mobile menu on navigate
    closeMobileMenu();
  }

  // Home view
  function renderHome(container) {
    if (!library) return;
    currentView = 'home';

    const albumCards = library.albums.map(album => createAlbumCard(album)).join('');

    container.innerHTML = `
      <div class="view-header">
        <h2 class="hero-text">All the anthems, unified in OnePlaylist.</h2>
        <p>${library.albums.length} album${library.albums.length !== 1 ? 's' : ''}, ${getTotalTracks()} tracks</p>
      </div>
      <div class="album-grid">
        ${albumCards}
      </div>`;

    attachAlbumCardListeners();
  }

  // Shuffle All view
  function renderShuffle(container) {
    if (!library) return;
    currentView = 'shuffle';

    // Build all tracks with album info, then shuffle
    const allTracks = [];
    library.albums.forEach(album => {
      album.tracks.forEach(track => {
        allTracks.push({ track, album });
      });
    });

    // Fisher-Yates shuffle
    for (let i = allTracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allTracks[i], allTracks[j]] = [allTracks[j], allTracks[i]];
    }

    const totalDuration = calculateTotalDuration(allTracks.map(t => t.track));

    const trackRows = allTracks.map((item, index) => `
      <div class="track-row shuffle-track-row" data-track-id="${item.track.id}" data-track-index="${index}">
        <div class="track-number">
          <span class="track-number-text">${index + 1}</span>
          <i class="fas fa-play track-play-icon"></i>
        </div>
        <div class="shuffle-track-info">
          <img class="shuffle-track-art" src="${escapeHtml(item.album.cover)}" alt="${escapeHtml(item.album.title)}"
               onerror="this.src='img/default-cover.svg'">
          <div class="shuffle-track-text">
            <span class="track-title">${escapeHtml(item.track.title)}</span>
            <span class="shuffle-track-artist">${escapeHtml(item.album.title)}</span>
          </div>
        </div>
        <div class="track-duration">${item.track.duration}</div>
        <div class="track-actions">
          <button class="track-download-btn" data-file="${escapeHtml(item.track.file)}" data-title="${escapeHtml(item.track.title)}" title="Download">
            <i class="fas fa-download"></i>
          </button>
        </div>
      </div>
    `).join('');

    container.innerHTML = `
      <div class="shuffle-view">
        <div class="shuffle-view-header">
          <div class="shuffle-view-info">
            <span class="shuffle-view-type">Playlist</span>
            <h1 class="shuffle-view-title">Shuffle All</h1>
            <div class="shuffle-view-meta">
              <span>${allTracks.length} songs, ${totalDuration}</span>
            </div>
            <div class="shuffle-view-actions">
              <button class="btn-play-shuffle" title="Play shuffled">
                <i class="fas fa-play"></i>
              </button>
              <button class="btn-reshuffle">
                <i class="fas fa-random"></i> Reshuffle
              </button>
            </div>
          </div>
        </div>
        <div class="tracklist-header shuffle-tracklist-header">
          <span>#</span>
          <span>Title</span>
          <span style="text-align:right">Duration</span>
          <span></span>
        </div>
        <div class="tracklist">
          ${trackRows}
        </div>
      </div>`;

    // Attach listeners
    document.querySelector('.btn-play-shuffle')?.addEventListener('click', () => {
      const btn = document.querySelector('.btn-play-shuffle');
      if (Player.getCurrentSong() && Player.isTrackPlaying(Player.getCurrentSong()._id)) {
        Player.togglePlayPause();
      } else {
        Player.shuffleAll();
      }
    });

    document.querySelector('.btn-reshuffle')?.addEventListener('click', () => {
      renderShuffle(container);
    });

    document.querySelectorAll('.shuffle-view .track-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.track-download-btn')) return;
        const trackId = row.dataset.trackId;
        Player.playTrack(trackId);
      });
    });

    document.querySelectorAll('.shuffle-view .track-download-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        Download.downloadTrack(btn.dataset.file, btn.dataset.title);
      });
    });
  }

  function calculateTotalDuration(tracks, includeSeconds = false) {
    let totalSeconds = 0;
    tracks.forEach(track => {
      const parts = track.duration.split(':');
      totalSeconds += parseInt(parts[0]) * 60 + parseInt(parts[1]);
    });
    const mins = Math.floor(totalSeconds / 60);
    if (mins >= 60) {
      const hrs = Math.floor(mins / 60);
      const remainMins = mins % 60;
      return `${hrs} hr ${remainMins} min`;
    }
    if (includeSeconds) {
      const secs = totalSeconds % 60;
      return `${mins} min ${secs} sec`;
    }
    return `${mins} min`;
  }

  // About view
  function renderAbout(container) {
    currentView = 'about';
    container.innerHTML = `
      <div class="view-header">
        <h2>About OnePlaylist</h2>
      </div>
      <div class="about-section">
        <div class="about-bio">
          <p>OnePlaylist is what happens when you turn documentation and technical concepts into songs that teach technology through clever lyrics and choruses.</p>
          <p>Each song probably could have been a slide deck, but we think a catchy hook works better instead.</p>
          <br>
          <p>Created by Guy in a Cube</p>
          <div class="about-links">
            <a href="https://www.guyinacube.com" target="_blank" rel="noopener" title="Guy in a Cube"><span class="giac-cube-icon" aria-hidden="true"></span></a>
            <a href="https://www.linkedin.com/company/guyinacube" target="_blank" rel="noopener" title="LinkedIn"><i class="fab fa-linkedin"></i></a>
            <a href="https://youtube.com/c/guyinacube" target="_blank" rel="noopener" title="YouTube"><i class="fab fa-youtube"></i></a>
          </div>
        </div>
      </div>`;
  }

  // Album detail view
  function renderAlbumDetail(container, slug, autoPlayTrack = null) {
    if (!library) return;
    currentView = 'album';

    const album = library.albums.find(a => a.slug === slug);
    if (!album) {
      container.innerHTML = `
        <div class="view-header">
          <h2>Album not found</h2>
          <p><a href="#/" style="color: var(--accent)">Go home</a></p>
        </div>`;
      return;
    }

    const trackRows = album.tracks.map((track, index) => createTrackRow(track, album, index)).join('');
    const totalDuration = calculateTotalDuration(album.tracks, true);

    container.innerHTML = `
      <div class="album-detail">
        <div class="album-detail-header">
          <img class="album-detail-art" src="${escapeHtml(album.cover)}" alt="${escapeHtml(album.title)}"
               onerror="this.src='img/default-cover.svg'">
          <div class="album-detail-info">
            <span class="album-detail-type">Album</span>
            <h1 class="album-detail-title">${escapeHtml(album.title)}</h1>
            <div class="album-detail-meta">
              <span>${album.year}</span>
              <span class="dot"></span>
              <span>${album.tracks.length} song${album.tracks.length !== 1 ? 's' : ''}, ${totalDuration}</span>
            </div>
            <div class="album-detail-actions">
              <button class="btn-play-album" data-album-slug="${album.slug}" title="Play album">
                <i class="fas fa-play"></i>
              </button>
              <button class="btn-share-album" data-album-slug="${album.slug}">
                <i class="fas fa-share-alt"></i> Share
              </button>
              <button class="btn-download-album" data-album-slug="${album.slug}">
                <i class="fas fa-download"></i> Download
              </button>
            </div>
          </div>
        </div>
        <div class="tracklist-header">
          <span>#</span>
          <span>Title</span>
          <span style="text-align:right">Duration</span>
          <span></span>
        </div>
        <div class="tracklist" data-album-slug="${album.slug}">
          ${trackRows}
        </div>
      </div>`;

    attachAlbumDetailListeners(album);

    // Auto-play track if deep-linked
    if (autoPlayTrack !== null) {
      const trackIndex = album.tracks.findIndex(t => t.trackNumber === autoPlayTrack);
      if (trackIndex !== -1) {
        Player.playAlbum(album.slug, false, trackIndex);
      }
    }
  }

  // Create album card HTML
  function createAlbumCard(album) {
    return `
      <a class="album-card" href="#/album/${album.slug}" data-album-slug="${album.slug}">
        <div class="album-card-wrapper">
          <img class="album-card-art" src="${escapeHtml(album.cover)}" alt="${escapeHtml(album.title)}"
               onerror="this.src='img/default-cover.svg'" loading="lazy">
          <button class="album-card-play" data-album-slug="${album.slug}" title="Play ${escapeHtml(album.title)}">
            <i class="fas fa-play"></i>
          </button>
        </div>
        <div class="album-card-title">${escapeHtml(album.title)}</div>
        <div class="album-card-meta">${album.year} · ${album.tracks.length} track${album.tracks.length !== 1 ? 's' : ''}</div>
      </a>`;
  }

  // Create track row HTML
  function createTrackRow(track, album, index) {
    return `
      <div class="track-row" data-track-index="${index}" data-track-id="${track.id}" data-album-slug="${album.slug}">
        <div class="track-number">
          <span class="track-number-text">${track.trackNumber}</span>
          <i class="fas fa-play track-play-icon"></i>
        </div>
        <div class="track-title">${escapeHtml(track.title)}</div>
        <div class="track-duration">${track.duration}</div>
        <div class="track-actions">
          <button class="track-share-btn" data-link="#/album/${album.slug}/${track.trackNumber}" title="Copy link">
            <i class="fas fa-link"></i>
          </button>
          <button class="track-download-btn" data-file="${escapeHtml(track.file)}" data-title="${escapeHtml(track.title)}" title="Download">
            <i class="fas fa-download"></i>
          </button>
        </div>
      </div>`;
  }

  // Attach listeners to album cards
  function attachAlbumCardListeners() {
    // Play buttons on cards (prevent navigation, start playing)
    document.querySelectorAll('.album-card-play').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const slug = btn.dataset.albumSlug;
        Player.playAlbum(slug);
      });
    });
  }

  // Attach listeners in album detail view
  function attachAlbumDetailListeners(album) {
    // Play album button
    const playBtn = document.querySelector('.btn-play-album');
    if (playBtn) {
      playBtn.addEventListener('click', () => Player.playAlbum(album.slug));
    }

    // Share album button
    const shareBtn = document.querySelector('.btn-share-album');
    if (shareBtn) {
      shareBtn.addEventListener('click', () => {
        const link = window.location.origin + window.location.pathname + '#/album/' + album.slug;
        navigator.clipboard.writeText(link).then(() => {
          showToast('Album link copied to clipboard');
        });
      });
    }

    // Download album button
    const dlBtn = document.querySelector('.btn-download-album');
    if (dlBtn) {
      dlBtn.addEventListener('click', () => Download.downloadAlbum(album));
    }

    // Track rows
    document.querySelectorAll('.track-row').forEach(row => {
      row.addEventListener('click', (e) => {
        // Don't trigger play if action button was clicked
        if (e.target.closest('.track-download-btn') || e.target.closest('.track-share-btn')) return;
        const index = parseInt(row.dataset.trackIndex);
        Player.playAlbum(album.slug, false, index);
      });
    });

    // Track share buttons
    document.querySelectorAll('.track-share-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const link = window.location.origin + window.location.pathname + btn.dataset.link;
        navigator.clipboard.writeText(link).then(() => {
          showToast('Link copied to clipboard');
        });
      });
    });

    // Track download buttons
    document.querySelectorAll('.track-download-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        Download.downloadTrack(btn.dataset.file, btn.dataset.title);
      });
    });
  }

  // Highlight currently playing track in tracklist
  function highlightActiveTrack(trackId) {
    document.querySelectorAll('.track-row').forEach(row => {
      const isActive = row.dataset.trackId === trackId;
      row.classList.toggle('active', isActive);
      const icon = row.querySelector('.track-play-icon');
      if (icon) {
        icon.classList.toggle('fa-pause', isActive && Player.isTrackPlaying(trackId));
        icon.classList.toggle('fa-play', !(isActive && Player.isTrackPlaying(trackId)));
      }
    });

    // Update album detail play button (green button → pause if playing)
    const playAlbumBtn = document.querySelector('.btn-play-album');
    if (playAlbumBtn) {
      const slug = playAlbumBtn.dataset.albumSlug;
      const isPlaying = Player.isAlbumPlaying(slug);
      playAlbumBtn.innerHTML = isPlaying
        ? '<i class="fas fa-pause"></i>'
        : '<i class="fas fa-play"></i>';
    }

    // Update album card play buttons
    document.querySelectorAll('.album-card-play').forEach(btn => {
      const slug = btn.dataset.albumSlug;
      const isPlaying = Player.isAlbumPlaying(slug);
      btn.innerHTML = isPlaying
        ? '<i class="fas fa-pause"></i>'
        : '<i class="fas fa-play"></i>';
    });

    // Update shuffle view play button
    const shufflePlayBtn = document.querySelector('.btn-play-shuffle');
    if (shufflePlayBtn) {
      const isPlaying = Player.getCurrentSong() && Player.isTrackPlaying(Player.getCurrentSong()._id);
      shufflePlayBtn.innerHTML = isPlaying
        ? '<i class="fas fa-pause"></i>'
        : '<i class="fas fa-play"></i>';
    }
  }

  // Helpers
  function getTotalTracks() {
    return library.albums.reduce((sum, album) => sum + album.tracks.length, 0);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Mobile menu
  function initMobileMenu() {
    const toggle = document.getElementById('menu-toggle');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');

    if (toggle) {
      toggle.addEventListener('click', () => {
        sidebar.classList.toggle('open');
        overlay.classList.toggle('active');
      });
    }

    if (overlay) {
      overlay.addEventListener('click', closeMobileMenu);
    }
  }

  function closeMobileMenu() {
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('sidebar-overlay')?.classList.remove('active');
  }

  // Toast notification
  function showToast(message) {
    let toast = document.querySelector('.toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
  }

  // Init
  async function init() {
    await loadLibrary();
    if (!library) return;

    // Initialize player once with full library
    Player.init(library);

    initRouter();
    initMobileMenu();
    initSidebar();

    // Shuffle All button — navigate to shuffle view
    document.getElementById('shuffle-all-btn')?.addEventListener('click', () => {
      window.location.hash = '#/shuffle';
    });

    // Download All button
    document.getElementById('download-all-btn')?.addEventListener('click', () => {
      Download.downloadAll();
    });
  }

  // Setup sidebar resize/collapse
  function initSidebar() {
    initSidebarResize();
    initSidebarCollapse();
  }

  function initSidebarResize() {
    const sidebar = document.getElementById('sidebar');
    const handle = document.getElementById('sidebar-resize-handle');
    if (!sidebar || !handle) return;

    let isResizing = false;

    handle.addEventListener('mousedown', (e) => {
      isResizing = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      const newWidth = Math.min(Math.max(e.clientX, 72), 400);
      sidebar.style.width = newWidth + 'px';
      document.documentElement.style.setProperty('--sidebar-width', newWidth + 'px');

      // Auto-collapse labels when narrow
      sidebar.classList.toggle('collapsed', newWidth < 140);
    });

    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });
  }

  function initSidebarCollapse() {
    const btn = document.getElementById('sidebar-collapse-btn');
    const sidebar = document.getElementById('sidebar');
    if (!btn || !sidebar) return;

    btn.addEventListener('click', () => {
      const isCollapsed = sidebar.classList.toggle('collapsed');
      const newWidth = isCollapsed ? 72 : 240;
      sidebar.style.width = newWidth + 'px';
      document.documentElement.style.setProperty('--sidebar-width', newWidth + 'px');
      btn.innerHTML = isCollapsed
        ? '<i class="fas fa-chevron-right"></i>'
        : '<i class="fas fa-chevron-left"></i>';
    });
  }

  // Start app when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return {
    getLibrary,
    highlightActiveTrack,
    showToast,
    escapeHtml
  };
})();
