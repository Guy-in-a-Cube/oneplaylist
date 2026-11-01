const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { library, loadScript, setupPlayer } = require('./helpers');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function downloadTest(name, run) {
  test(name, async t => {
    const context = setupPlayer();
    const { window } = context;
    t.after(() => window.close());
    window.setImmediate = setImmediate;
    window.eval(fs.readFileSync(require.resolve('jszip/dist/jszip.js'), 'utf8'));
    const blobs = new Map();
    const saved = [];
    const warnings = [];
    window.console.warn = (...args) => warnings.push(args);
    window.URL.createObjectURL = blob => {
      const url = `blob:download-${blobs.size}`;
      blobs.set(url, blob);
      return url;
    };
    window.URL.revokeObjectURL = url => blobs.delete(url);
    window.HTMLAnchorElement.prototype.click = function () {
      saved.push({ filename: this.download, blob: blobs.get(this.href) });
    };
    const requested = [];
    window.fetch = async url => {
      requested.push(url);
      return { ok: true, status: 200, blob: async () => new window.Blob([`content:${url}`]) };
    };
    const Download = loadScript(window, 'download.js', 'Download');
    await run({ ...context, Download, blobs, saved, requested, warnings, deferred });
  });
}

downloadTest('track downloads fetch the file before saving its bytes', async ({ Download, requested, saved, window }) => {
  await Download.downloadTrack(library.albums[0].tracks[0].file, 'One');
  assert.deepEqual(requested, ['media/first/One.mp3']);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].filename, 'one.mp3');
  assert.equal(await new Promise(resolve => {
    const reader = new window.FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsText(saved[0].blob);
  }), 'content:media/first/One.mp3');
});

downloadTest('a missing track reports failure and does not start a download', async ({ Download, window, saved, toasts }) => {
  window.fetch = async () => ({ ok: false, status: 404 });
  await Download.downloadTrack('missing.mp3', 'Missing');
  assert.equal(saved.length, 0);
  assert.match(toasts.at(-1), /failed/i);
});

downloadTest('album ZIP contains all requested songs and cover art', async ({ Download, saved, window }) => {
  await Download.downloadAlbum(library.albums[0]);
  assert.equal(saved.length, 1);
  const zip = await window.JSZip.loadAsync(saved[0].blob);
  assert.deepEqual(Object.keys(zip.files).sort(), [
    'first-album/', 'first-album/01-one.mp3', 'first-album/02-two.mp3',
    'first-album/03-three.mp3', 'first-album/cover.jpg'
  ]);
  assert.equal(await zip.file('first-album/02-two.mp3').async('string'), 'content:media/first/Two.mp3');
});

downloadTest('one failed song rejects the entire archive instead of omitting it', async ({ Download, window, saved, toasts }) => {
  const fetch = window.fetch;
  window.fetch = url => url.endsWith('Two.mp3')
    ? Promise.resolve({ ok: false, status: 404 }) : fetch(url);
  await Download.downloadAlbum(library.albums[0]);
  assert.equal(saved.length, 0);
  assert.match(toasts.at(-1), /failed/i);
});

downloadTest('ZIP generation stays pending without announcing success', async ({ Download, window, toasts, saved }) => {
  const pending = deferred();
  window.JSZip.prototype.generateAsync = () => pending.promise;
  let finished = false;
  const operation = Download.downloadAlbum(library.albums[0]).then(() => { finished = true; });
  await new Promise(resolve => window.setTimeout(resolve, 20));
  assert.equal(finished, false);
  assert.equal(saved.length, 0);
  assert.ok(window.document.querySelector('.download-progress'));
  assert.equal(toasts.some(message => /Downloaded|ready/i.test(message)), false);
  pending.resolve(new window.Blob(['zip']));
  await operation;
  assert.equal(saved.length, 1);
});

downloadTest('ZIP generation rejection is caught and resets the download guard', async ({ Download, window, toasts, saved }) => {
  const generate = window.JSZip.prototype.generateAsync;
  window.JSZip.prototype.generateAsync = async () => { throw new Error('Cannot generate ZIP'); };
  await Download.downloadAlbum(library.albums[0]);
  assert.equal(saved.length, 0);
  assert.match(toasts.at(-1), /failed/i);
  window.JSZip.prototype.generateAsync = generate;
  await Download.downloadAlbum(library.albums[0]);
  assert.equal(saved.length, 1);
});

downloadTest('repeated clicks do not create concurrent album archives', async ({ Download, window, saved }) => {
  const pending = deferred();
  const fetch = window.fetch;
  window.fetch = async url => { await pending.promise; return fetch(url); };
  const first = Download.downloadAlbum(library.albums[0]);
  const second = Download.downloadAlbum(library.albums[0]);
  pending.resolve();
  await Promise.all([first, second]);
  assert.equal(saved.length, 1);
});

downloadTest('repeated track clicks fetch and save only once', async ({ Download, window, saved }) => {
  const pending = deferred();
  let fetches = 0;
  window.fetch = async () => {
    fetches++;
    await pending.promise;
    return { ok: true, status: 200, blob: async () => new window.Blob(['track']) };
  };
  const first = Download.downloadTrack('one.mp3', 'One');
  const second = Download.downloadTrack('one.mp3', 'One');
  pending.resolve();
  await Promise.all([first, second]);
  assert.equal(fetches, 1);
  assert.equal(saved.length, 1);
});

downloadTest('optional missing cover is disclosed while every song is retained', async ({ Download, window, saved, toasts }) => {
  const fetch = window.fetch;
  window.fetch = url => url.endsWith('cover.jpg')
    ? Promise.resolve({ ok: false, status: 404 }) : fetch(url);
  await Download.downloadAlbum(library.albums[0]);
  assert.equal(saved.length, 1);
  const zip = await window.JSZip.loadAsync(saved[0].blob);
  assert.equal(Object.keys(zip.files).filter(name => name.endsWith('.mp3')).length, 3);
  assert.match(toasts.at(-1), /cover/i);
});

downloadTest('all-album ZIP includes every album and track', async ({ Download, window, saved }) => {
  await Download.downloadAll();
  assert.equal(saved.length, 1);
  const zip = await window.JSZip.loadAsync(saved[0].blob);
  assert.equal(Object.keys(zip.files).filter(name => name.endsWith('.mp3')).length, 4);
  assert.ok(zip.file('second-album/01-four.mp3'));
});

downloadTest('download object URLs remain usable until the browser starts saving', async ({ Download, blobs }) => {
  await Download.downloadAlbum(library.albums[0]);
  assert.equal(blobs.size, 1);
});

downloadTest('empty audio responses do not create successful downloads', async ({ Download, window, saved, toasts }) => {
  window.fetch = async () => ({ ok: true, status: 200, blob: async () => new window.Blob([]) });
  await Download.downloadTrack('empty.mp3', 'Empty');
  assert.equal(saved.length, 0);
  assert.match(toasts.at(-1), /failed/i);
});

downloadTest('tracks with colliding sanitized filenames are all preserved', async ({ Download, window, saved }) => {
  const album = {
    ...library.albums[0],
    tracks: [
      { ...library.albums[0].tracks[0], title: 'A/B', trackNumber: 1 },
      { ...library.albums[0].tracks[1], title: 'AB', trackNumber: 1 }
    ]
  };
  await Download.downloadAlbum(album);
  const zip = await window.JSZip.loadAsync(saved[0].blob);
  assert.equal(Object.keys(zip.files).filter(name => name.endsWith('.mp3')).length, 2);
});
