/* ============================================
   OnePlaylist — Player (AmplitudeJS wrapper)
   
   Architecture: Initialize Amplitude ONCE with
   all songs. Use playSongAtIndex() to switch.
   No re-init = no audio bleed.
   ============================================ */

const Player = (() => {
  let isInitialized = false;
  let shuffleOn = false;
  let repeatMode = 0; // 0 = off, 1 = repeat all, 2 = repeat one
  let allSongs = [];
  let currentAlbumSlug = null;

  // Queue model: we drive next/prev ourselves instead of relying on
  // Amplitude's global navigation, so playback stays within the chosen context.
  let queue = [];          // global indices (into allSongs) in play order
  let queuePos = -1;       // pointer into `queue`
  let baseOrder = [];      // queue order before shuffle (for un-shuffling)
  let queueContext = null; // { type: 'album', slug } | { type: 'all' }
  let isScrubbing = false; // true while user drags the progress bar

  // Build the master song list from library
  function buildSongList(library) {
    const songs = [];
    library.albums.forEach(album => {
      album.tracks.forEach(track => {
        songs.push({
          name: track.title,
          artist: library.artist,
          album: album.title,
          url: encodeURI(track.file),
          cover_art_url: encodeURI(album.cover),
          _id: track.id,
          _albumSlug: album.slug,
          _trackNumber: track.trackNumber,
          _rawUrl: track.file
        });
      });
    });
    return songs;
  }

  // Initialize — called once on app start
  function init(library) {
    allSongs = buildSongList(library);
    if (allSongs.length === 0) return;

    Amplitude.init({
      songs: allSongs,
      volume: 80,
      continue_next: false,
      callbacks: {
        song_change: onSongChange,
        play: onPlay,
        pause: onPause,
        ended: onEnded,
        timeupdate: onTimeUpdate
      }
    });

    isInitialized = true;
    bindControls();
    bindKeyboard();
    bindProgressUpdates();
  }

  // Find the global index of a song by its ID
  function findSongIndex(trackId) {
    return allSongs.findIndex(s => s._id === trackId);
  }

  // Get indices of all songs in an album
  function getAlbumIndices(slug) {
    const indices = [];
    allSongs.forEach((s, i) => {
      if (s._albumSlug === slug) indices.push(i);
    });
    return indices;
  }

  // Fisher-Yates shuffle of a copy
  function shuffledCopy(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Establish a new playback queue and start playing `startGlobalIndex`.
  function setQueue(indices, startGlobalIndex, context) {
    baseOrder = indices.slice();
    queueContext = context;

    if (shuffleOn) {
      queue = shuffledCopy(baseOrder);
      // Move the chosen song to the front so playback starts there.
      const at = queue.indexOf(startGlobalIndex);
      if (at > 0) {
        queue.splice(at, 1);
        queue.unshift(startGlobalIndex);
      }
      queuePos = 0;
    } else {
      queue = baseOrder.slice();
      queuePos = queue.indexOf(startGlobalIndex);
      if (queuePos === -1) queuePos = 0;
    }

    playCurrent();
  }

  // Play whatever song the queue pointer currently references.
  function playCurrent() {
    if (queuePos < 0 || queuePos >= queue.length) return;
    showPlayerBar();
    Amplitude.playSongAtIndex(queue[queuePos]);
    updatePlayerUI();
  }

  // Advance to the next song, honoring repeat mode and queue boundaries.
  function next() {
    if (!isInitialized || queue.length === 0) return;

    if (repeatMode === 2) { // repeat one
      playCurrent();
      return;
    }

    if (queuePos < queue.length - 1) {
      queuePos++;
    } else if (repeatMode === 1) { // repeat all -> wrap to start
      queuePos = 0;
    } else {
      return; // end of queue, stop
    }

    playCurrent();
  }

  // Go to the previous song. Restart the current track if we're past 3s in.
  function prev() {
    if (!isInitialized || queue.length === 0) return;

    if (repeatMode !== 2 && Amplitude.getSongPlayedSeconds() <= 3) {
      if (queuePos > 0) {
        queuePos--;
      } else if (repeatMode === 1) {
        queuePos = queue.length - 1;
      }
    }

    playCurrent();
  }

  // Natural end of a track (Amplitude's continue_next is disabled).
  function onEnded() {
    next();
  }

  // Play a specific album, optionally starting at a track index within the album
  function playAlbum(slug, shuffle = false, albumTrackIndex = null) {
    if (!isInitialized) return;

    const albumIndices = getAlbumIndices(slug);
    if (albumIndices.length === 0) return;

    currentAlbumSlug = slug;

    const inThisAlbum =
      queueContext && queueContext.type === 'album' && queueContext.slug === slug;

    // Album-level play button (no specific track requested)
    if (albumTrackIndex === null) {
      if (inThisAlbum && Amplitude.getActiveSongMetadata()) {
        // Already playing this album -> toggle play/pause
        togglePlayPause();
        return;
      }
      albumTrackIndex = 0;
    } else {
      // A specific track was clicked -> toggle if it's already the active song
      const gi = albumIndices[albumTrackIndex];
      if (inThisAlbum && Amplitude.getActiveIndex() === gi) {
        togglePlayPause();
        return;
      }
    }

    if (shuffle) {
      shuffleOn = true;
      updateShuffleUI();
    }

    const startGlobalIndex = albumIndices[albumTrackIndex] ?? albumIndices[0];
    setQueue(albumIndices, startGlobalIndex, { type: 'album', slug });
  }

  // Play a specific track by ID
  function playTrack(trackId) {
    if (!isInitialized) return;

    const globalIndex = findSongIndex(trackId);
    if (globalIndex === -1) return;

    if (Amplitude.getActiveIndex() === globalIndex) {
      // Same track -- toggle play/pause
      togglePlayPause();
      return;
    }

    // Clicking a track in a full-library list plays within that library context.
    const allIndices = allSongs.map((_, i) => i);
    setQueue(allIndices, globalIndex, { type: 'all' });
  }

  // Shuffle all tracks
  function shuffleAll() {
    if (!isInitialized) return;

    currentAlbumSlug = null;
    shuffleOn = true;
    updateShuffleUI();

    const allIndices = allSongs.map((_, i) => i);
    setQueue(allIndices, allIndices[0], { type: 'all' });
    App.showToast('Shuffling all tracks');
  }

  // Toggle play/pause
  function togglePlayPause() {
    if (!isInitialized) return;
    if (Amplitude.getPlayerState() === 'playing') {
      Amplitude.pause();
    } else {
      Amplitude.play();
    }
  }

  // Check if a specific track is currently playing
  function isTrackPlaying(trackId) {
    if (!isInitialized) return false;
    const meta = Amplitude.getActiveSongMetadata();
    return meta && meta._id === trackId && Amplitude.getPlayerState() === 'playing';
  }

  // Check if a specific track is the active (current) track
  function isTrackActive(trackId) {
    if (!isInitialized) return false;
    const meta = Amplitude.getActiveSongMetadata();
    return meta && meta._id === trackId;
  }

  // Check if an album is currently playing
  function isAlbumPlaying(slug) {
    if (!isInitialized) return false;
    const meta = Amplitude.getActiveSongMetadata();
    return meta && meta._albumSlug === slug && Amplitude.getPlayerState() === 'playing';
  }

  // Bind player controls (called once)
  function bindControls() {
    document.getElementById('btn-shuffle')?.addEventListener('click', toggleShuffle);
    document.getElementById('btn-repeat')?.addEventListener('click', toggleRepeat);
    document.getElementById('btn-volume')?.addEventListener('click', toggleMute);

    // Play/Pause button
    document.getElementById('btn-play-pause')?.addEventListener('click', togglePlayPause);

    // Prev/Next
    document.getElementById('btn-prev')?.addEventListener('click', () => {
      if (isInitialized) prev();
    });
    document.getElementById('btn-next')?.addEventListener('click', () => {
      if (isInitialized) next();
    });

    // Download current track
    document.getElementById('btn-download-current')?.addEventListener('click', () => {
      const song = Amplitude.getActiveSongMetadata();
      if (song && song._rawUrl) {
        Download.downloadTrack(song._rawUrl, song.name);
      }
    });

    // Album art click → navigate to album
    document.getElementById('player-art')?.addEventListener('click', () => {
      const song = Amplitude.getActiveSongMetadata();
      if (song && song._albumSlug) {
        window.location.hash = `#/album/${song._albumSlug}`;
      }
    });

    // Keep the mute icon in sync when the volume slider is dragged
    document.querySelector('.volume-slider')?.addEventListener('input', (e) => {
      const volBtn = document.getElementById('btn-volume');
      if (!volBtn) return;
      const v = parseInt(e.target.value);
      volBtn.innerHTML = v === 0
        ? '<i class="fas fa-volume-mute"></i>'
        : '<i class="fas fa-volume-up"></i>';
    });
  }

  // Progress bar binding
  function bindProgressUpdates() {
    const progressBar = document.querySelector('.progress-bar');
    if (progressBar) {
      progressBar.max = 100;
      progressBar.value = 0;

      progressBar.addEventListener('input', () => {
        isScrubbing = true;
      });
      progressBar.addEventListener('change', () => {
        Amplitude.setSongPlayedPercentage(parseFloat(progressBar.value));
        isScrubbing = false;
      });
    }
  }

  // Called by AmplitudeJS on each time update
  function onTimeUpdate() {
    if (!isInitialized) return;

    const bar = document.querySelector('.progress-bar');
    if (bar && !isScrubbing) {
      const pct = Amplitude.getSongPlayedPercentage();
      if (!isNaN(pct)) bar.value = pct;
    }

    updateTimeDisplay();
  }

  function updateTimeDisplay() {
    const currentMins = document.querySelector('[data-amplitude-current-minutes]');
    const currentSecs = document.querySelector('[data-amplitude-current-seconds]');
    const durationMins = document.querySelector('[data-amplitude-duration-minutes]');
    const durationSecs = document.querySelector('[data-amplitude-duration-seconds]');

    const played = Amplitude.getSongPlayedSeconds();
    if (currentMins && !isNaN(played)) {
      currentMins.textContent = Math.floor(played / 60);
      if (currentSecs) currentSecs.textContent = Math.floor(played % 60).toString().padStart(2, '0');
    }

    const dur = Amplitude.getSongDuration();
    if (durationMins && !isNaN(dur)) {
      durationMins.textContent = Math.floor(dur / 60);
      if (durationSecs) durationSecs.textContent = Math.floor(dur % 60).toString().padStart(2, '0');
    }
  }

  // Keyboard shortcuts
  function bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          togglePlayPause();
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (isInitialized) next();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (isInitialized) prev();
          break;
        case 'KeyS':
          if (!e.ctrlKey && !e.metaKey) toggleShuffle();
          break;
        case 'KeyR':
          if (!e.ctrlKey && !e.metaKey) toggleRepeat();
          break;
      }
    });
  }

  // Shuffle toggle
  function toggleShuffle() {
    if (!isInitialized) return;
    shuffleOn = !shuffleOn;

    // Re-order the existing queue around the currently playing song.
    if (queue.length > 0 && queuePos >= 0) {
      const currentGlobalIndex = queue[queuePos];
      if (shuffleOn) {
        queue = shuffledCopy(baseOrder);
        const at = queue.indexOf(currentGlobalIndex);
        if (at > 0) {
          queue.splice(at, 1);
          queue.unshift(currentGlobalIndex);
        }
        queuePos = 0;
      } else {
        queue = baseOrder.slice();
        queuePos = queue.indexOf(currentGlobalIndex);
        if (queuePos === -1) queuePos = 0;
      }
    }

    updateShuffleUI();
    App.showToast(shuffleOn ? 'Shuffle on' : 'Shuffle off');
  }

  function updateShuffleUI() {
    const btn = document.getElementById('btn-shuffle');
    if (btn) btn.classList.toggle('active', shuffleOn);
  }

  // Repeat toggle: off → all → one → off
  function toggleRepeat() {
    if (!isInitialized) return;
    repeatMode = (repeatMode + 1) % 3;
    const btn = document.getElementById('btn-repeat');

    switch (repeatMode) {
      case 0:
        btn?.classList.remove('active', 'repeat-one');
        App.showToast('Repeat off');
        break;
      case 1:
        btn?.classList.add('active');
        btn?.classList.remove('repeat-one');
        App.showToast('Repeat all');
        break;
      case 2:
        btn?.classList.add('active', 'repeat-one');
        App.showToast('Repeat one');
        break;
    }
  }

  // Mute toggle
  let previousVolume = 80;
  function toggleMute() {
    const slider = document.querySelector('.volume-slider');
    const volBtn = document.getElementById('btn-volume');
    const currentVol = parseInt(slider?.value || 80);

    if (currentVol > 0) {
      previousVolume = currentVol;
      Amplitude.setVolume(0);
      if (slider) slider.value = 0;
      if (volBtn) volBtn.innerHTML = '<i class="fas fa-volume-mute"></i>';
    } else {
      Amplitude.setVolume(previousVolume);
      if (slider) slider.value = previousVolume;
      if (volBtn) volBtn.innerHTML = '<i class="fas fa-volume-up"></i>';
    }
  }

  // Callbacks
  function onSongChange() {
    updatePlayerUI();
    updateMediaSession();
  }

  function onPlay() {
    showPlayerBar();
    updatePlayerUI();
    updateMediaSession();
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
  }

  function onPause() {
    updatePlayerUI();
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
  }

  // Update player bar UI
  function updatePlayerUI() {
    const song = Amplitude.getActiveSongMetadata();
    if (!song) return;

    const art = document.getElementById('player-art');
    if (art) {
      art.src = song.cover_art_url || 'img/default-cover.svg';
      art.onerror = () => { art.src = 'img/default-cover.svg'; };
    }

    const titleEl = document.querySelector('.player-title');
    const artistEl = document.querySelector('.player-artist');
    if (titleEl) titleEl.textContent = song.name || '';
    if (artistEl) artistEl.textContent = song.album || '';

    // Update play/pause button icon
    const playPauseBtn = document.getElementById('btn-play-pause');
    if (playPauseBtn) {
      const isPlaying = Amplitude.getPlayerState() === 'playing';
      playPauseBtn.classList.toggle('playing', isPlaying);
    }

    // Highlight active track in tracklist
    App.highlightActiveTrack(song._id);
  }

  // Media Session API
  function updateMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const song = Amplitude.getActiveSongMetadata();
    if (!song) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.name,
      artist: song.artist,
      album: song.album,
      artwork: [
        { src: song.cover_art_url || 'img/default-cover.svg', sizes: '512x512', type: 'image/jpeg' }
      ]
    });

    navigator.mediaSession.setActionHandler('play', () => Amplitude.play());
    navigator.mediaSession.setActionHandler('pause', () => Amplitude.pause());
    navigator.mediaSession.setActionHandler('previoustrack', () => prev());
    navigator.mediaSession.setActionHandler('nexttrack', () => next());
  }

  // Show player bar
  function showPlayerBar() {
    const bar = document.getElementById('player-bar');
    if (bar) bar.classList.remove('hidden');
  }

  // Get current song metadata
  function getCurrentSong() {
    if (!isInitialized) return null;
    return Amplitude.getActiveSongMetadata();
  }

  return {
    init,
    playAlbum,
    playTrack,
    shuffleAll,
    togglePlayPause,
    isTrackPlaying,
    isTrackActive,
    isAlbumPlaying,
    getCurrentSong
  };
})();
