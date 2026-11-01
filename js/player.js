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

  // Queue model: we drive next/prev ourselves instead of relying on
  // Amplitude's global navigation, so playback stays within the chosen context.
  let queue = [];          // global indices (into allSongs) in play order
  let queuePos = -1;       // pointer into `queue`
  let baseOrder = [];      // queue order before shuffle (for un-shuffling)
  let queueContext = null; // { type: 'album', slug } | { type: 'all' }
  let isScrubbing = false; // true while user drags the progress bar
  let queueEnded = false;
  let playlistOrder = [];
  let previousVolume = 80;

  // Build the master song list from library
  function buildSongList(library) {
    const songs = [];
    library.albums.forEach(album => {
      album.tracks.forEach(track => {
        songs.push({
          name: track.title,
          artist: library.artist,
          album: album.title,
          url: App.mediaUrl(track.file),
          cover_art_url: App.mediaUrl(album.cover),
          _id: track.id,
          _albumSlug: album.slug,
          _trackNumber: track.trackNumber,
          _duration: track.duration,
          _rawUrl: track.file
        });
      });
    });
    return songs;
  }

  // Initialize — called once on app start
  function init(library) {
    if (isInitialized) return;
    if (typeof Amplitude === 'undefined') {
      App.showToast('The audio player could not load. Please reload the page.');
      return;
    }
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
        timeupdate: onTimeUpdate,
        durationchange: onTimeUpdate,
        error: onError
      }
    });

    isInitialized = true;
    const audio = Amplitude.getAudio();
    const nativePlay = audio.play.bind(audio);
    // Amplitude 5.3.2 makes two play() calls but catches only one promise.
    // Handle both on this audio element, not through a global error handler.
    audio.play = () => {
      const source = audio.src;
      return nativePlay()?.catch(error => {
        if (error.name === 'AbortError') {
          console.debug('Playback request cancelled:', error);
        } else if (source !== audio.src) {
          console.warn('Superseded playback request failed:', error);
        } else {
          onError(error);
        }
      });
    };
    // Amplitude schedules a stop on ended even with continue_next:false.
    // Capture the event so only our context-aware queue handles the ending.
    audio.addEventListener('ended', event => {
      event.stopImmediatePropagation();
      onEnded();
    }, true);
    audio.addEventListener('volumechange', updateVolumeUI);
    bindControls();
    bindKeyboard();
    bindProgressUpdates();
    bindMediaSession();
    updateShuffleUI();
    updateVolumeUI();
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
  function setQueue(indices, startGlobalIndex, context, order = null) {
    baseOrder = indices.slice();
    queueContext = context;

    queue = order ? order.slice() : (shuffleOn ? shuffledCopy(baseOrder) : baseOrder.slice());
    if (shuffleOn && !order && startGlobalIndex !== null) {
      // Move the chosen song to the front so playback starts there.
      const at = queue.indexOf(startGlobalIndex);
      if (at > 0) {
        queue.splice(at, 1);
        queue.unshift(startGlobalIndex);
      }
    }
    queuePos = startGlobalIndex === null ? 0 : queue.indexOf(startGlobalIndex);
    if (queuePos === -1) queuePos = 0;
    queueEnded = false;
    notifyQueueChange();
    playCurrent();
  }

  // Play whatever song the queue pointer currently references.
  function playCurrent() {
    if (queuePos < 0 || queuePos >= queue.length) return;
    queueEnded = false;
    isScrubbing = false;
    showPlayerBar();
    Amplitude.playSongAtIndex(queue[queuePos]);
    updatePlayerUI();
  }

  // Advance to the next song, honoring repeat mode and queue boundaries.
  function next() {
    if (!isInitialized || queue.length === 0) return;

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

    if (Amplitude.getSongPlayedSeconds() <= 3) {
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
    if (repeatMode === 2) {
      playCurrent();
    } else if (queuePos < queue.length - 1 || repeatMode === 1) {
      next();
    } else {
      queueEnded = true;
      Amplitude.pause();
      onTimeUpdate();
      updatePlayerUI();
    }
  }

  // Play a specific album, optionally starting at a track index within the album
  function playAlbum(slug, shuffle = false, albumTrackIndex = null) {
    if (!isInitialized) return;

    const albumIndices = getAlbumIndices(slug);
    if (albumIndices.length === 0) return;

    const inThisAlbum =
      queueContext && queueContext.type === 'album' && queueContext.slug === slug;

    // Album-level play button (no specific track requested)
    if (albumTrackIndex === null && !shuffle) {
      if (inThisAlbum && queuePos >= 0) {
        // Already playing this album -> toggle play/pause
        togglePlayPause();
        return;
      }
    } else if (albumTrackIndex !== null) {
      // A specific track was clicked -> toggle if it's already the active song
      const gi = albumIndices[albumTrackIndex];
      if (inThisAlbum && Amplitude.getActiveIndex() === gi && !shuffle) {
        if (queueEnded) playCurrent();
        else togglePlayPause();
        return;
      }
    }

    if (shuffle) {
      shuffleOn = true;
      updateShuffleUI();
    }

    const startGlobalIndex = albumTrackIndex === null ? null : albumIndices[albumTrackIndex];
    if (albumTrackIndex !== null && startGlobalIndex === undefined) {
      App.showToast('This track is not available.');
      return;
    }
    setQueue(albumIndices, startGlobalIndex, { type: 'album', slug });
  }

  // Play a specific track by ID
  function playTrack(trackId) {
    if (!isInitialized) return;

    const globalIndex = findSongIndex(trackId);
    if (globalIndex === -1) return;

    if (isPlaylistContext() && queuePos >= 0 && Amplitude.getActiveIndex() === globalIndex) {
      // Same track -- toggle play/pause
      if (queueEnded) playCurrent();
      else togglePlayPause();
      return;
    }

    if (isPlaylistContext()) {
      queuePos = queue.indexOf(globalIndex);
      playCurrent();
      return;
    }
    // Clicking a track in a full-library list plays within that library context.
    const allIndices = allSongs.map((_, i) => i);
    setQueue(allIndices, globalIndex, { type: 'all' });
  }

  // Shuffle all tracks
  function shuffleAll() {
    if (!isInitialized) return;
    playlistOrder = shuffledCopy(allSongs.map((_, i) => i));
    startPlaylist(null);
    App.showToast('Shuffling all tracks');
  }

  function isPlaylistContext() {
    return queueContext?.type === 'all';
  }

  function isAlbumContext(slug) {
    return queueContext?.type === 'album' && queueContext.slug === slug;
  }

  function getPlaylistTrackIds() {
    if (isPlaylistContext()) return queue.map(index => allSongs[index]._id);
    if (playlistOrder.length === 0) {
      playlistOrder = shuffledCopy(allSongs.map((_, i) => i));
    }
    return playlistOrder.map(index => allSongs[index]._id);
  }

  function startPlaylist(trackId) {
    getPlaylistTrackIds();
    shuffleOn = true;
    updateShuffleUI();
    const index = trackId === null ? null : findSongIndex(trackId);
    if (index === -1) {
      App.showToast('This track is not available.');
      return;
    }
    setQueue(allSongs.map((_, i) => i), index, { type: 'all' }, playlistOrder);
  }

  function playPlaylist(trackId = null) {
    if (!isInitialized) return;
    if (!isPlaylistContext()) {
      startPlaylist(trackId);
    } else if (trackId === null) {
      togglePlayPause();
    } else {
      playTrack(trackId);
    }
  }

  function reshufflePlaylist() {
    if (!isInitialized) return;
    const current = isPlaylistContext() && queuePos >= 0 ? queue[queuePos] : null;
    playlistOrder = shuffledCopy(allSongs.map((_, i) => i).filter(index => index !== current));
    if (current !== null) {
      playlistOrder.unshift(current);
      queue = playlistOrder.slice();
      queuePos = 0;
      shuffleOn = true;
      updateShuffleUI();
    }
    notifyQueueChange();
    App.showToast('Playlist reshuffled');
  }

  function notifyQueueChange() {
    if (isPlaylistContext()) playlistOrder = queue.slice();
    document.dispatchEvent(new CustomEvent('playerqueuechange'));
  }

  // Toggle play/pause
  function togglePlayPause() {
    if (!isInitialized) return;
    if (queue.length === 0) {
      const slug = allSongs[0]._albumSlug;
      playAlbum(slug);
      return;
    }
    if (Amplitude.getPlayerState() === 'playing') {
      Amplitude.pause();
    } else {
      if (queueEnded) {
        queuePos = 0;
        playCurrent();
      } else {
        Amplitude.play();
      }
    }
  }

  // Check if a specific track is currently playing
  function isTrackPlaying(trackId) {
    if (!isInitialized || queuePos < 0) return false;
    const meta = Amplitude.getActiveSongMetadata();
    return meta && meta._id === trackId && Amplitude.getPlayerState() === 'playing';
  }

  // Check if a specific track is the active (current) track
  function isTrackActive(trackId) {
    if (!isInitialized || queuePos < 0) return false;
    const meta = Amplitude.getActiveSongMetadata();
    return meta && meta._id === trackId;
  }

  // Check if an album is currently playing
  function isAlbumPlaying(slug) {
    if (!isInitialized || queuePos < 0) return false;
    const meta = Amplitude.getActiveSongMetadata();
    return isAlbumContext(slug) && meta && Amplitude.getPlayerState() === 'playing';
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
      const volume = Number(e.target.value);
      if (volume > 0) previousVolume = volume;
      Amplitude.setVolume(volume);
      updateVolumeUI();
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
        updateTimeDisplay(Amplitude.getSongDuration() * Number(progressBar.value) / 100);
      });
      progressBar.addEventListener('change', () => {
        seekTo(Amplitude.getSongDuration() * Number(progressBar.value) / 100);
        isScrubbing = false;
        onTimeUpdate();
      });
      progressBar.addEventListener('blur', () => {
        isScrubbing = false;
        onTimeUpdate();
      });
    }

  }

  function seekTo(seconds) {
    const duration = Amplitude.getSongDuration();
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(seconds)) return;
    const position = Math.max(0, Math.min(seconds, duration));
    Amplitude.getAudio().currentTime = position;
    if (position < duration) queueEnded = false;
  }

  // Called by AmplitudeJS on each time update
  function onTimeUpdate() {
    if (!isInitialized) return;

    const bar = document.querySelector('.progress-bar');
    if (bar && !isScrubbing) {
      const pct = Amplitude.getSongPlayedPercentage();
      if (Number.isFinite(pct)) bar.value = pct;
      bar.disabled = !Number.isFinite(Amplitude.getSongDuration()) || Amplitude.getSongDuration() <= 0;
    }

    updateTimeDisplay();
    updateMediaPosition();
  }

  function updateTimeDisplay(preview = null) {
    const currentMins = document.querySelector('[data-amplitude-current-minutes]');
    const currentSecs = document.querySelector('[data-amplitude-current-seconds]');
    const durationMins = document.querySelector('[data-amplitude-duration-minutes]');
    const durationSecs = document.querySelector('[data-amplitude-duration-seconds]');

    const played = preview ?? Amplitude.getSongPlayedSeconds();
    if (currentMins && Number.isFinite(played)) {
      currentMins.textContent = Math.floor(played / 60);
      if (currentSecs) currentSecs.textContent = Math.floor(played % 60).toString().padStart(2, '0');
    }

    const song = getCurrentSong();
    const parts = song?._duration.split(':').map(Number);
    const duration = Amplitude.getSongDuration();
    const dur = Number.isFinite(duration) ? duration : (parts ? parts[0] * 60 + parts[1] : 0);
    if (durationMins && Number.isFinite(dur)) {
      durationMins.textContent = Math.floor(dur / 60);
      if (durationSecs) durationSecs.textContent = Math.floor(dur % 60).toString().padStart(2, '0');
    }
    document.querySelector('.progress-bar')?.setAttribute('aria-valuetext',
      `${Math.floor(played / 60)}:${String(Math.floor(played % 60)).padStart(2, '0')} of ${Math.floor(dur / 60)}:${String(Math.floor(dur % 60)).padStart(2, '0')}`);
  }

  // Keyboard shortcuts
  function bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat ||
          e.target.closest('input, textarea, select, button, a, [contenteditable], [role="button"]')) return;

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
    notifyQueueChange();
    App.showToast(shuffleOn ? 'Shuffle on' : 'Shuffle off');
  }

  function updateShuffleUI() {
    const btn = document.getElementById('btn-shuffle');
    if (btn) {
      btn.classList.toggle('active', shuffleOn);
      btn.setAttribute('aria-pressed', String(shuffleOn));
      btn.title = shuffleOn ? 'Turn shuffle off' : 'Turn shuffle on';
      btn.setAttribute('aria-label', btn.title);
    }
  }

  // Repeat toggle: off → all → one → off
  function toggleRepeat() {
    if (!isInitialized) return;
    repeatMode = (repeatMode + 1) % 3;
    const btn = document.getElementById('btn-repeat');
    if (btn) {
      btn.title = ['Repeat off', 'Repeat all', 'Repeat one'][repeatMode];
      btn.setAttribute('aria-label', btn.title);
      btn.setAttribute('aria-pressed', String(repeatMode !== 0));
    }

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
  function toggleMute() {
    const audio = Amplitude.getAudio();
    const currentVol = audio.muted ? 0 : Math.round(audio.volume * 100);

    if (currentVol > 0) {
      previousVolume = currentVol;
      Amplitude.setVolume(0);
    } else {
      Amplitude.setVolume(previousVolume);
    }
    updateVolumeUI();
  }

  function updateVolumeUI() {
    const audio = Amplitude.getAudio();
    const volume = audio.muted ? 0 : Math.round(audio.volume * 100);
    const slider = document.querySelector('.volume-slider');
    if (slider) slider.value = volume;
    const button = document.getElementById('btn-volume');
    if (button) {
      button.innerHTML = volume === 0 ? '<i class="fas fa-volume-mute"></i>' : '<i class="fas fa-volume-up"></i>';
      button.title = volume === 0 ? 'Unmute' : 'Mute';
      button.setAttribute('aria-label', button.title);
      button.setAttribute('aria-pressed', String(volume === 0));
    }
  }

  // Callbacks
  function onSongChange() {
    isScrubbing = false;
    updatePlayerUI();
    onTimeUpdate();
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

  function onError(error = Amplitude.getAudio().error) {
    console.error('Audio playback error:', error);
    Amplitude.pause();
    App.showToast('Could not play this track. Please try again or skip to the next song.');
  }

  // Update player bar UI
  function updatePlayerUI() {
    const song = getCurrentSong();
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
      playPauseBtn.title = isPlaying ? 'Pause' : 'Play';
      playPauseBtn.setAttribute('aria-label', playPauseBtn.title);
    }

    // Highlight active track in tracklist
    App.highlightActiveTrack(song._id);
  }

  // Media Session API
  function updateMediaSession() {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    const song = Amplitude.getActiveSongMetadata();
    if (!song) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.name,
      artist: song.artist,
      album: song.album,
      artwork: [
        { src: song.cover_art_url || 'img/default-cover.svg' }
      ]
    });
  }

  function bindMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const handlers = {
      play: () => {
        if (Amplitude.getPlayerState() !== 'playing') togglePlayPause();
      },
      pause: () => Amplitude.pause(),
      previoustrack: prev,
      nexttrack: next,
      seekbackward: details => seekTo(Amplitude.getSongPlayedSeconds() - (details.seekOffset ?? 10)),
      seekforward: details => seekTo(Amplitude.getSongPlayedSeconds() + (details.seekOffset ?? 10)),
      seekto: details => seekTo(details.seekTime)
    };
    Object.entries(handlers).forEach(([action, handler]) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch (error) {
        console.warn(`Media action "${action}" is unavailable:`, error);
      }
    });
  }

  function updateMediaPosition() {
    if (!navigator.mediaSession?.setPositionState || !getCurrentSong()) return;
    const duration = Amplitude.getSongDuration();
    const position = Amplitude.getSongPlayedSeconds();
    if (Number.isFinite(duration) && duration > 0 && Number.isFinite(position)) {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: Amplitude.getAudio().playbackRate,
        position: Math.max(0, Math.min(position, duration))
      });
    }
  }

  // Show player bar
  function showPlayerBar() {
    const bar = document.getElementById('player-bar');
    if (bar) bar.classList.remove('hidden');
  }

  // Get current song metadata
  function getCurrentSong() {
    if (!isInitialized || queuePos < 0) return null;
    return Amplitude.getActiveSongMetadata();
  }

  return {
    init,
    playAlbum,
    playTrack,
    shuffleAll,
    playPlaylist,
    reshufflePlaylist,
    getPlaylistTrackIds,
    isPlaylistContext,
    isAlbumContext,
    togglePlayPause,
    isTrackPlaying,
    isTrackActive,
    isAlbumPlaying,
    getCurrentSong
  };
})();
