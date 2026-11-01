const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { chromium } = require('playwright-core');
const JSZip = require('jszip');

const root = path.resolve(__dirname, '..');
const library = JSON.parse(fs.readFileSync(path.join(root, 'library.json'), 'utf8'));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png' };

const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!file.startsWith(`${root}${path.sep}`) || !types[path.extname(file)] || !fs.existsSync(file)) {
    response.writeHead(404).end();
    return;
  }
  const size = fs.statSync(file).size;
  const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
  const start = range ? Number(range[1]) : 0;
  const end = range && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start > end) {
    response.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
    return;
  }
  const headers = { 'Content-Type': types[path.extname(file)], 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes' };
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  response.writeHead(range ? 206 : 200, headers);
  fs.createReadStream(file, { start, end }).pipe(response);
});

async function readDownload(download) {
  assert.equal(await download.failure(), null);
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function verifyArchive(bytes, tracks) {
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const files = Object.values(zip.files).filter(file => !file.dir && file.name.endsWith('.mp3'));
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const actual = await Promise.all(files.map(async file => hash(await file.async('nodebuffer'))));
  const expected = tracks.map(track => hash(fs.readFileSync(path.join(root, track.file))));
  assert.deepEqual(actual.sort(), expected.sort());
}

async function main() {
  let browser;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    browser = await chromium.launch({
      headless: true,
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
        : { channel: process.platform === 'win32' ? 'msedge' : 'chrome' })
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForSelector('.album-card');
    assert.equal(await page.locator('#player-bar').isVisible(), false);
    await page.locator('.album-card-play').first().click();
    await page.waitForFunction(() => !Amplitude.getAudio().paused && Amplitude.getAudio().currentTime > 0.2);
    assert.equal(await page.evaluate(() => Player.getCurrentSong()._id), library.albums[0].tracks[0].id);

    await page.locator('#btn-play-pause').focus();
    await page.keyboard.press('Space');
    await page.waitForFunction(() => Amplitude.getAudio().paused);
    await page.keyboard.press('Space');
    await page.waitForFunction(() => !Amplitude.getAudio().paused);

    await page.locator('.volume-slider').fill('35');
    assert.equal(await page.evaluate(() => Amplitude.getAudio().volume), 0.35);
    await page.locator('#btn-volume').click();
    assert.equal(await page.evaluate(() => Amplitude.getAudio().muted), true);
    await page.locator('#btn-volume').click();
    assert.equal(await page.evaluate(() => Amplitude.getAudio().volume), 0.35);
    await page.locator('.progress-bar').fill('50');
    const progress = await page.evaluate(() => Amplitude.getAudio().currentTime / Amplitude.getAudio().duration);
    assert.ok(progress >= 0.49 && progress <= 0.52);

    await page.evaluate(() => {
      const audio = Amplitude.getAudio();
      audio.currentTime = audio.duration - 0.1;
    });
    await page.waitForFunction(id => Player.getCurrentSong()._id === id &&
      !Amplitude.getAudio().paused && Amplitude.getAudio().currentTime > 0.2,
    library.albums[0].tracks[1].id);
    await page.locator('#player-art').click();
    await page.waitForSelector('.track-row.active');
    assert.ok(await page.locator('.btn-play-album .fa-pause').count());

    await page.locator('#shuffle-all-btn').click();
    await page.waitForSelector('.shuffle-view');
    await page.locator('.btn-play-shuffle').click();
    const ids = await page.locator('.shuffle-track-row').evaluateAll(rows => rows.map(row => row.dataset.trackId));
    assert.equal(await page.evaluate(() => Player.getCurrentSong()._id), ids[0]);
    await page.locator('.shuffle-track-row').nth(2).click();
    await page.locator('#btn-next').click();
    assert.equal(await page.evaluate(() => Player.getCurrentSong()._id), ids[3]);
    await page.locator('.btn-reshuffle').click();
    assert.equal(await page.locator('.shuffle-track-row').first().getAttribute('data-track-id'), ids[3]);

    const trackDownload = page.waitForEvent('download');
    await page.locator('#btn-download-current').click();
    const current = await page.evaluate(() => Player.getCurrentSong()._rawUrl);
    assert.deepEqual(await readDownload(await trackDownload), fs.readFileSync(path.join(root, current)));
    await page.locator('#player-art').click();
    await page.waitForSelector('.btn-download-album');
    const albumSlug = await page.locator('.btn-download-album').getAttribute('data-album-slug');
    const album = library.albums.find(item => item.slug === albumSlug);
    const albumDownload = page.waitForEvent('download');
    await page.locator('.btn-download-album').click();
    await verifyArchive(await readDownload(await albumDownload), album.tracks);

    const allDownload = page.waitForEvent('download');
    await page.locator('#download-all-btn').click();
    await verifyArchive(await readDownload(await allDownload), library.albums.flatMap(album => album.tracks));

    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      for (const selector of ['#btn-shuffle', '#btn-repeat', '.progress-bar', '#btn-download-current']) {
        assert.equal(await page.locator(selector).isVisible(), true, `${selector} must be usable on mobile`);
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflow, false);
      const bar = await page.locator('#player-bar').boundingBox();
      assert.ok(bar.y + bar.height <= 844);
      for (const selector of ['.player-track-info', '.player-controls', '.player-progress', '.player-extras']) {
        const bounds = await page.locator(selector).boundingBox();
        assert.ok(bounds.y >= bar.y && bounds.y + bounds.height <= bar.y + bar.height,
          `${selector} must fit inside the mobile player bar`);
      }
    }
    assert.deepEqual(errors, []);
    const linkedPage = await browser.newPage({ acceptDownloads: true });
    const linkErrors = [];
    linkedPage.on('pageerror', error => linkErrors.push(error.message));
    await linkedPage.goto(`http://127.0.0.1:${server.address().port}/#/album/${library.albums[0].slug}/2`);
    await linkedPage.waitForSelector('.track-row');
    await linkedPage.waitForTimeout(300);
    assert.equal(await linkedPage.evaluate(() => Player.getCurrentSong()), null);
    assert.match(await linkedPage.locator('.toast').innerText(), /Play/);
    await linkedPage.locator('.track-play-button').nth(1).click();
    await linkedPage.waitForFunction(() => !Amplitude.getAudio().paused && Amplitude.getAudio().currentTime > 0.2);
    assert.deepEqual(linkErrors, []);
    await linkedPage.close();
    console.log('Browser smoke passed: real audio, transport, seeking, volume, shuffle queue, MP3/ZIP bytes, mobile controls.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
