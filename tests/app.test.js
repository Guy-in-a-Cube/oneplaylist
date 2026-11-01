const test = require('node:test');
const assert = require('node:assert/strict');
const { library, loadScript, setupPlayer } = require('./helpers');

function appTest(name, run) {
  test(name, async t => {
    const context = setupPlayer();
    t.after(() => context.dom.window.close());
    context.window.fetch = async () => ({ ok: true, json: async () => library });
    context.window.Download = { downloadTrack() {}, downloadAlbum() {}, downloadAll() {} };
    loadScript(context.window, 'app.js', 'App');
    await new Promise(resolve => context.window.setTimeout(resolve, 0));
    const route = hash => {
      context.window.history.replaceState(null, '', hash);
      context.window.dispatchEvent(new context.window.HashChangeEvent('hashchange'));
    };
    const rows = () => [...context.window.document.querySelectorAll('.track-row')];
    await run({ ...context, route, rows });
  });
}

appTest('shuffle rows define the actual playback order after choosing a song', ({ Player, click, route, rows }) => {
  route('#/shuffle');
  const expected = rows().map(row => row.dataset.trackId);
  rows()[2].click();
  assert.equal(Player.getCurrentSong()._id, expected[2]);
  click('btn-next');
  assert.equal(Player.getCurrentSong()._id, expected[3]);
});

appTest('opening shuffle does not play and its play button starts the displayed first song', ({ Player, window, route, rows }) => {
  route('#/shuffle');
  assert.equal(Player.getCurrentSong(), null);
  const firstId = rows()[0].dataset.trackId;
  window.document.querySelector('.btn-play-shuffle').click();
  assert.equal(Player.getCurrentSong()._id, firstId);
});

appTest('shuffle play starts the playlist instead of pausing an unrelated album', ({ Player, audio, window, route }) => {
  Player.playAlbum('first');
  route('#/shuffle');
  window.document.querySelector('.btn-play-shuffle').click();
  assert.equal(audio.paused, false);
  assert.equal(Player.isPlaylistContext(), true);
});

appTest('playlist pause and resume preserves its song and position', ({ Player, audio, window, route }) => {
  route('#/shuffle');
  window.document.querySelector('.btn-play-shuffle').click();
  const song = Player.getCurrentSong()._id;
  audio.currentTime = 37;
  window.document.querySelector('.btn-play-shuffle').click();
  assert.equal(audio.paused, true);
  window.document.querySelector('.btn-play-shuffle').click();
  assert.equal(Player.getCurrentSong()._id, song);
  assert.equal(audio.currentTime, 37);
});

appTest('reshuffle keeps the playing song and updates both queue and list', ({ Player, audio, window, route, rows, click }) => {
  route('#/shuffle');
  rows()[1].click();
  const song = Player.getCurrentSong()._id;
  audio.currentTime = 29;
  window.document.querySelector('.btn-reshuffle').click();
  assert.equal(rows()[0].dataset.trackId, song);
  assert.equal(audio.currentTime, 29);
  const next = rows()[1].dataset.trackId;
  click('btn-next');
  assert.equal(Player.getCurrentSong()._id, next);
});

appTest('turning shuffle off updates the visible list without interrupting playback', ({ Player, audio, route, rows, click }) => {
  route('#/shuffle');
  rows()[1].click();
  audio.currentTime = 15;
  click('btn-shuffle');
  assert.deepEqual(rows().map(row => row.dataset.trackId), ['one', 'two', 'three', 'four']);
  assert.equal(audio.currentTime, 15);
  assert.equal(rows().find(row => row.classList.contains('active')).dataset.trackId, Player.getCurrentSong()._id);
});

appTest('navigation immediately restores active rows and album play indicators', ({ Player, window, route, rows }) => {
  Player.playAlbum('first', false, 1);
  route('#/album/first');
  assert.equal(rows()[1].classList.contains('active'), true);
  assert.ok(window.document.querySelector('.btn-play-album .fa-pause'));
  route('#/');
  assert.ok(window.document.querySelector('[data-album-slug="first"] .album-card-play .fa-pause'));
});

appTest('album indicators do not claim to pause a full-library context', ({ Player, window, route }) => {
  Player.playAlbum('first');
  Player.playTrack('one');
  route('#/album/first');
  assert.ok(window.document.querySelector('.btn-play-album .fa-play'));
  window.document.querySelector('.btn-play-album').click();
  assert.equal(Player.isPlaylistContext(), false);
});

appTest('deep-linked tracks play once and stay highlighted after navigation', ({ Player, route, rows, audio }) => {
  route('#/album/first/2');
  assert.equal(Player.getCurrentSong()._id, 'two');
  route('#/about');
  route('#/album/first/2');
  assert.equal(audio.paused, false);
  assert.equal(rows()[1].classList.contains('active'), true);
});

appTest('track play buttons are keyboard-operable without downloading a song', ({ Player, window, route, rows }) => {
  route('#/album/first');
  const button = rows()[1].querySelector('.track-play-button');
  assert.ok(button, 'Each row should have a real play button');
  assert.equal(button.tagName, 'BUTTON');
  assert.match(button.getAttribute('aria-label'), /Two/);
  button.click();
  assert.equal(Player.getCurrentSong()._id, 'two');
});

appTest('media file paths keep reserved filename characters out of URL syntax', ({ window }) => {
  assert.equal(window.App.mediaUrl("media/100% hits/What's #1?.mp3"),
    "media/100%25%20hits/What's%20%231%3F.mp3");
});

appTest('fresh deep links focus the requested song instead of attempting blocked autoplay', ({ Player, window, route, rows }) => {
  Object.defineProperty(window.navigator, 'userActivation', { value: { hasBeenActive: false } });
  route('#/album/first/2');
  assert.equal(Player.getCurrentSong(), null);
  assert.equal(window.document.activeElement, rows()[1].querySelector('.track-play-button'));
  assert.match(window.document.querySelector('.toast').textContent, /Play/);
});
