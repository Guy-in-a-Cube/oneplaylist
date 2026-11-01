const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const library = {
  artist: 'Test Artist',
  albums: [
    {
      slug: 'first', title: 'First Album', year: 2025, cover: 'media/first/cover.jpg',
      tracks: [
        { id: 'one', title: 'One', trackNumber: 1, duration: '2:00', file: 'media/first/One.mp3' },
        { id: 'two', title: 'Two', trackNumber: 2, duration: '2:00', file: 'media/first/Two.mp3' },
        { id: 'three', title: 'Three', trackNumber: 3, duration: '2:00', file: 'media/first/Three.mp3' }
      ]
    },
    {
      slug: 'second', title: 'Second Album', year: 2026, cover: 'media/second/cover.png',
      tracks: [
        { id: 'four', title: 'Four', trackNumber: 1, duration: '3:00', file: 'media/second/Four.mp3' }
      ]
    }
  ]
};

function loadScript(window, filename, name) {
  window.eval(`${fs.readFileSync(path.join(__dirname, '..', 'js', filename), 'utf8')}\nwindow.${name} = ${name};`);
  return window[name];
}

function setupPlayer({ random = 0, fixture = library, mediaSession = null, playError = null } = {}) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only' });
  const { window } = dom;
  if (mediaSession) {
    Object.defineProperty(window.navigator, 'mediaSession', { value: mediaSession });
    window.MediaMetadata = class {
      constructor(metadata) { Object.assign(this, metadata); }
    };
  }
  const audio = new window.EventTarget();
  Object.assign(audio, { currentTime: 0, duration: 120, volume: 0.8, muted: false, paused: true, ended: false, playbackRate: 1 });
  let songs = [];
  let activeIndex = 0;
  let callbacks;
  const played = [];
  const toasts = [];
  const errors = [];
  window.Math.random = () => random;
  window.console.error = (...args) => errors.push(args);
  window.App = {
    highlightActiveTrack() {},
    showToast: message => toasts.push(message),
    getLibrary: () => fixture,
    mediaUrl: file => file.split('/').map(encodeURIComponent).join('/'),
    escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')
  };

  audio.play = () => {
    if (playError) return Promise.reject(playError);
    audio.paused = false;
    audio.ended = false;
    audio.dispatchEvent(new window.Event('play'));
    callbacks.play?.();
    return Promise.resolve();
  };

  function play() {
    const promise = audio.play();
    promise?.catch(() => {});
    audio.play();
  }

  function pause() {
    audio.paused = true;
    audio.dispatchEvent(new window.Event('pause'));
    callbacks.pause?.();
  }

  window.Amplitude = {
    init(config) {
      songs = config.songs;
      callbacks = config.callbacks;
      // Amplitude's native ended handler queues a stop, even with continue_next:false.
      audio.addEventListener('ended', () => {
        window.setTimeout(() => {
          audio.currentTime = 0;
          pause();
        }, 0);
      });
      audio.addEventListener('ended', () => callbacks.ended?.());
      audio.addEventListener('error', () => callbacks.error?.());
      audio.addEventListener('timeupdate', () => callbacks.timeupdate?.());
    },
    playSongAtIndex(index) {
      pause();
      audio.currentTime = 0;
      activeIndex = index;
      played.push(songs[index]._id);
      callbacks.song_change?.();
      play();
    },
    play, pause,
    getAudio: () => audio,
    getActiveIndex: () => activeIndex,
    getActiveSongMetadata: () => songs[activeIndex],
    getPlayerState: () => audio.paused ? 'paused' : 'playing',
    getSongPlayedSeconds: () => audio.currentTime,
    getSongDuration: () => audio.duration,
    getSongPlayedPercentage: () => audio.currentTime / audio.duration * 100,
    setSongPlayedPercentage(value) {
      if (value > 0 && value < 100) audio.currentTime = audio.duration * value / 100;
    },
    setVolume(value) {
      audio.volume = value / 100;
      audio.muted = value === 0;
      audio.dispatchEvent(new window.Event('volumechange'));
    }
  };
  const Player = loadScript(window, 'player.js', 'Player');
  Player.init(fixture);
  const click = id => window.document.getElementById(id).click();
  const end = () => {
    audio.currentTime = audio.duration;
    audio.paused = true;
    audio.ended = true;
    audio.dispatchEvent(new window.Event('ended'));
  };
  return { dom, window, Player, audio, played, toasts, errors, click, end };
}

module.exports = { library, loadScript, setupPlayer };
