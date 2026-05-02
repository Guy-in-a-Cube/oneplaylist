#!/usr/bin/env node
/* ============================================
   build-library.js
   
   Scans media/ folders for MP3 files, reads
   ID3 metadata, extracts cover art, and
   generates library.json automatically.
   
   Usage: node scripts/build-library.js
   ============================================ */

const fs = require('fs');
const path = require('path');
const { parseFile } = require('music-metadata');

const MEDIA_DIR = path.join(__dirname, '..', 'media');
const OUTPUT_FILE = path.join(__dirname, '..', 'library.json');
const DEFAULT_ARTIST = 'Unknown Artist';

async function buildLibrary() {
  console.log('🎵 Scanning media/ for MP3 files...\n');

  // Get all album folders
  const entries = fs.readdirSync(MEDIA_DIR, { withFileTypes: true });
  const albumFolders = entries
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort();

  if (albumFolders.length === 0) {
    console.log('No album folders found in media/. Add folders with MP3 files.');
    process.exit(0);
  }

  const albums = [];
  let globalArtist = null;

  for (const folder of albumFolders) {
    const folderPath = path.join(MEDIA_DIR, folder);
    const files = fs.readdirSync(folderPath)
      .filter(f => f.toLowerCase().endsWith('.mp3'))
      .sort();

    if (files.length === 0) {
      console.log(`  ⏭️  Skipping "${folder}" — no MP3 files`);
      continue;
    }

    console.log(`  📁 ${folder} (${files.length} tracks)`);

    const tracks = [];
    let albumTitle = null;
    let albumArtist = null;
    let albumYear = null;
    let coverExtracted = false;

    for (const file of files) {
      const filePath = path.join(folderPath, file);

      try {
        const metadata = await parseFile(filePath);
        const { common, format } = metadata;

        // Extract track info
        const title = common.title || file.replace(/\.mp3$/i, '').replace(/^\d+-\s*/, '');
        const artist = common.artist || common.albumartist || DEFAULT_ARTIST;
        const album = common.album || folder;
        const year = common.year || null;
        const trackNum = common.track?.no || tracks.length + 1;
        const duration = formatDuration(format.duration || 0);

        // Use first track's album info as the album metadata
        if (!albumTitle) albumTitle = album;
        if (!albumArtist) albumArtist = artist;
        if (!albumYear && year) albumYear = year;
        if (!globalArtist) globalArtist = common.albumartist || artist;

        // Extract cover art from first track that has it (skip if cover already exists)
        if (!coverExtracted && !existingCoverFile(folderPath) && common.picture && common.picture.length > 0) {
          const pic = common.picture[0];
          const ext = getImageExtension(pic.format);
          const coverPath = path.join(folderPath, `cover.${ext}`);
          fs.writeFileSync(coverPath, pic.data);
          coverExtracted = true;
          console.log(`    🖼️  Extracted cover art → cover.${ext}`);
        }

        tracks.push({
          id: `${folder}-track-${trackNum}`,
          title: title,
          trackNumber: trackNum,
          duration: duration,
          file: `media/${folder}/${file}`
        });

      } catch (err) {
        console.warn(`    ⚠️  Error reading "${file}": ${err.message}`);
        // Add track with filename-derived info
        tracks.push({
          id: `${folder}-track-${tracks.length + 1}`,
          title: file.replace(/\.mp3$/i, '').replace(/^\d+-\s*/, ''),
          trackNumber: tracks.length + 1,
          duration: '0:00',
          file: `media/${folder}/${file}`
        });
      }
    }

    // Sort tracks by track number
    tracks.sort((a, b) => a.trackNumber - b.trackNumber);

    // Determine cover file path
    const coverFile = findCoverFile(folderPath, folder);

    albums.push({
      id: folder,
      title: albumTitle || folder,
      slug: folder,
      year: albumYear || new Date().getFullYear(),
      cover: coverFile,
      tracks: tracks
    });
  }

  // Build final library object
  const library = {
    artist: globalArtist || DEFAULT_ARTIST,
    albums: albums
  };

  // Write library.json
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(library, null, 2) + '\n');

  console.log(`\n✅ Generated library.json`);
  console.log(`   ${albums.length} album(s), ${albums.reduce((s, a) => s + a.tracks.length, 0)} track(s)`);
  console.log(`   Artist: ${library.artist}`);
}

// Format seconds to M:SS
function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Get image file extension from MIME type
function getImageExtension(mimeType) {
  if (!mimeType) return 'png';
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('gif')) return 'gif';
  if (mimeType.includes('webp')) return 'webp';
  return 'jpg';
}

// Check if a cover file already exists in the folder
function existingCoverFile(folderPath) {
  const candidates = ['cover.png', 'cover.jpg', 'cover.jpeg', 'cover.webp'];
  return candidates.some(name => fs.existsSync(path.join(folderPath, name)));
}

// Find existing cover file or determine expected path
function findCoverFile(folderPath, folder) {
  const candidates = ['cover.png', 'cover.jpg', 'cover.jpeg', 'cover.webp'];
  for (const name of candidates) {
    if (fs.existsSync(path.join(folderPath, name))) {
      return `media/${folder}/${name}`;
    }
  }
  return `media/${folder}/cover.png`;
}

// Run
buildLibrary().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
