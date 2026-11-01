const test = require('node:test');
const assert = require('node:assert/strict');
const { setupPlayer } = require('./helpers');

function playerTest(name, run) {
  test(name, async t => {
    const context = setupPlayer();
    t.after(() => context.dom.window.close());
    await run(context);
  });
}

playerTest('the first track click establishes a queue and next advances', ({ Player, click }) => {
  Player.playTrack('one');
  click('btn-next');
  assert.equal(Player.getCurrentSong()._id, 'two');
});

playerTest('unselected Amplitude metadata is not an active track', ({ Player }) => {
  assert.equal(Player.isTrackActive('one'), false);
  assert.equal(Player.getCurrentSong(), null);
});

playerTest('Shuffle All starts randomly instead of pinning the library first track', ({ Player }) => {
  Player.shuffleAll();
  assert.equal(Player.getCurrentSong()._id, 'two');
});

playerTest('natural endings advance and are not stopped by Amplitude afterwards', async ({ Player, audio, end, window }) => {
  Player.playAlbum('first');
  end();
  await new Promise(resolve => window.setTimeout(resolve, 10));
  assert.equal(Player.getCurrentSong()._id, 'two');
  assert.equal(audio.paused, false);
});

playerTest('repeat one repeats natural endings but manual next skips', ({ Player, click, end }) => {
  Player.playAlbum('first');
  click('btn-repeat');
  click('btn-repeat');
  end();
  assert.equal(Player.getCurrentSong()._id, 'one');
  click('btn-next');
  assert.equal(Player.getCurrentSong()._id, 'two');
});

playerTest('repeat one does not prevent previous within the first three seconds', ({ Player, click }) => {
  Player.playAlbum('first', false, 1);
  click('btn-repeat');
  click('btn-repeat');
  click('btn-prev');
  assert.equal(Player.getCurrentSong()._id, 'one');
});

playerTest('previous after three seconds restarts without changing tracks', ({ Player, audio, click }) => {
  Player.playAlbum('first', false, 1);
  audio.currentTime = 10;
  click('btn-prev');
  assert.equal(Player.getCurrentSong()._id, 'two');
  assert.equal(audio.currentTime, 0);
});

playerTest('repeat off ends the album and play restarts its queue', ({ Player, audio, click, end }) => {
  Player.playAlbum('first', false, 2);
  end();
  assert.equal(audio.paused, true);
  click('btn-play-pause');
  assert.equal(Player.getCurrentSong()._id, 'one');
  assert.equal(audio.paused, false);
});

playerTest('repeat all wraps at the album boundary', ({ Player, click, end }) => {
  Player.playAlbum('first', false, 2);
  click('btn-repeat');
  end();
  assert.equal(Player.getCurrentSong()._id, 'one');
});

playerTest('switching to the library context works even for the same song', ({ Player, click }) => {
  Player.playAlbum('first', false, 2);
  Player.playTrack('three');
  click('btn-next');
  assert.equal(Player.getCurrentSong()._id, 'four');
});

playerTest('shuffle toggles preserve the active song and playback position', ({ Player, audio, click }) => {
  Player.playAlbum('first', false, 1);
  audio.currentTime = 15;
  click('btn-shuffle');
  assert.equal(Player.getCurrentSong()._id, 'two');
  assert.equal(audio.currentTime, 15);
  click('btn-shuffle');
  click('btn-next');
  assert.equal(Player.getCurrentSong()._id, 'three');
});

playerTest('seeking includes zero and the end of the track', ({ Player, audio, window }) => {
  Player.playAlbum('first');
  const bar = window.document.querySelector('.progress-bar');
  audio.currentTime = 45;
  bar.value = '0';
  bar.dispatchEvent(new window.Event('change'));
  assert.equal(audio.currentTime, 0);
  bar.value = '100';
  bar.dispatchEvent(new window.Event('change'));
  assert.equal(audio.currentTime, 120);
});

playerTest('volume input changes audio and mute restores the last nonzero level', ({ audio, window, click }) => {
  const slider = window.document.querySelector('.volume-slider');
  slider.value = '35';
  slider.dispatchEvent(new window.Event('input'));
  assert.equal(audio.volume, 0.35);
  slider.value = '0';
  slider.dispatchEvent(new window.Event('input'));
  click('btn-volume');
  assert.equal(audio.volume, 0.35);
});

playerTest('keyboard shortcuts leave focused buttons and modifier combinations alone', ({ Player, audio, window }) => {
  Player.playAlbum('first');
  window.document.getElementById('btn-next').dispatchEvent(new window.KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
  assert.equal(audio.paused, false);
  window.document.body.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'ArrowRight', ctrlKey: true, bubbles: true }));
  assert.equal(Player.getCurrentSong()._id, 'one');
});

playerTest('playback failures pause the UI and notify the listener', ({ Player, audio, toasts, window }) => {
  Player.playAlbum('first');
  audio.error = { code: 4 };
  audio.dispatchEvent(new window.Event('error'));
  assert.equal(audio.paused, true);
  assert.match(toasts.at(-1), /play|load/i);
  assert.equal(window.document.getElementById('btn-play-pause').classList.contains('playing'), false);
});

playerTest('seeking after queue exhaustion resumes the current song at the chosen position', ({ Player, audio, window, end, click }) => {
  Player.playAlbum('first', false, 2);
  end();
  const bar = window.document.querySelector('.progress-bar');
  bar.value = '50';
  bar.dispatchEvent(new window.Event('change'));
  click('btn-play-pause');
  assert.equal(Player.getCurrentSong()._id, 'three');
  assert.equal(audio.currentTime, 60);
});

playerTest('shuffled album playback starts randomly without repeating before the boundary', ({ Player, click, played }) => {
  Player.playAlbum('first', true);
  click('btn-next');
  click('btn-next');
  assert.deepEqual(played, ['two', 'three', 'one']);
});

test('OS media transport and seeking honor the same queue and bounds', t => {
  const handlers = {};
  const positions = [];
  const mediaSession = {
    setActionHandler: (action, handler) => { handlers[action] = handler; },
    setPositionState: state => positions.push(state)
  };
  const { Player, audio, window, click, dom } = setupPlayer({ mediaSession });
  t.after(() => dom.window.close());
  Player.playAlbum('first');
  click('btn-repeat');
  click('btn-repeat');
  handlers.nexttrack();
  assert.equal(Player.getCurrentSong()._id, 'two');
  handlers.seekto({ seekTime: 25 });
  assert.equal(audio.currentTime, 25);
  handlers.seekbackward({ seekOffset: 40 });
  assert.equal(audio.currentTime, 0);
  handlers.seekforward({ seekOffset: 200 });
  assert.equal(audio.currentTime, 120);
  audio.dispatchEvent(new window.Event('timeupdate'));
  assert.equal(positions.at(-1).position, 120);
  handlers.pause();
  assert.equal(audio.paused, true);
  handlers.play();
  assert.equal(audio.paused, false);
  assert.equal(mediaSession.metadata.title, 'Two');
});

test('rejected playback promises notify the listener without unhandled rejections', async t => {
  const playError = Object.assign(new Error('Playback is not allowed'), { name: 'NotAllowedError' });
  const { Player, toasts, audio, window, dom } = setupPlayer({ playError });
  t.after(() => dom.window.close());
  Player.playAlbum('first');
  await new Promise(resolve => window.setTimeout(resolve, 10));
  assert.match(toasts.at(-1), /play/i);
  assert.equal(audio.paused, true);
});
