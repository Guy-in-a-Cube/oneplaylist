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
      callbacks: {
        song_change: onSongChange,
        play: onPlay,
        pause: onPause,
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

  // Play a specific album, optionally starting at a track index within the album
  function playAlbum(slug, shuffle = false, albumTrackIndex = 0) {
    if (!isInitialized) return;

    const albumIndices = getAlbumIndices(slug);
    if (albumIndices.length === 0) return;

    currentAlbumSlug = slug;

    // Calculate the global song index
    const globalIndex = albumIndices[albumTrackIndex] ?? albumIndices[0];

    // Check if this exact song is already the active one
    const activeIndex = Amplitude.getActiveIndex();

    if (activeIndex === globalIndex) {
      // Same track — toggle play/pause
      if (Amplitude.getPlayerState() === 'playing') {
        Amplitude.pause();
      } else {
        Amplitude.play();
      }
      return;
    }

    // Handle shuffle
    if (shuffle) {
      shuffleOn = true;
      Amplitude.setShuffle(true);
      updateShuffleUI();
    }

    // Play the song at the global index
    showPlayerBar();
    Amplitude.playSongAtIndex(globalIndex);
    updatePlayerUI();
  }

  // Play a specific track by ID
  function playTrack(trackId) {
    if (!isInitialized) return;

    const globalIndex = findSongIndex(trackId);
    if (globalIndex === -1) return;

    const activeIndex = Amplitude.getActiveIndex();

    if (activeIndex === globalIndex) {
      // Same track — toggle play/pause
      if (Amplitude.getPlayerState() === 'playing') {
        Amplitude.pause();
      } else {
        Amplitude.play();
      }
      return;
    }

    showPlayerBar();
    Amplitude.playSongAtIndex(globalIndex);
    updatePlayerUI();
  }

  // Shuffle all tracks
  function shuffleAll() {
    if (!isInitialized) return;

    currentAlbumSlug = null;
    shuffleOn = true;
    Amplitude.setShuffle(true);
    updateShuffleUI();
    showPlayerBar();

    // Play a random track
    const randomIndex = Math.floor(Math.random() * allSongs.length);
    Amplitude.playSongAtIndex(randomIndex);
    updatePlayerUI();
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
      if (isInitialized) Amplitude.prev();
    });
    document.getElementById('btn-next')?.addEventListener('click', () => {
      if (isInitialized) Amplitude.next();
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
  }

  // Progress bar binding
  function bindProgressUpdates() {
    const progressBar = document.querySelector('.progress-bar');
    if (progressBar) {
      progressBar.max = 100;
      progressBar.value = 0;

      progressBar.addEventListener('input', () => {
        Amplitude.setSongPlayedPercentage(parseFloat(progressBar.value));
      });
    }
  }

  // Called by AmplitudeJS on each time update
  function onTimeUpdate() {
    if (!isInitialized) return;

    const bar = document.querySelector('.progress-bar');
    if (bar) {
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
          if (isInitialized) Amplitude.next();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (isInitialized) Amplitude.prev();
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
    Amplitude.setShuffle(shuffleOn);
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
        Amplitude.setRepeat(false);
        Amplitude.setRepeatSong(false);
        btn?.classList.remove('active', 'repeat-one');
        App.showToast('Repeat off');
        break;
      case 1:
        Amplitude.setRepeat(true);
        Amplitude.setRepeatSong(false);
        btn?.classList.add('active');
        btn?.classList.remove('repeat-one');
        App.showToast('Repeat all');
        break;
      case 2:
        Amplitude.setRepeat(false);
        Amplitude.setRepeatSong(true);
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
  }

  function onPause() {
    updatePlayerUI();
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
    navigator.mediaSession.setActionHandler('previoustrack', () => Amplitude.prev());
    navigator.mediaSession.setActionHandler('nexttrack', () => Amplitude.next());
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
