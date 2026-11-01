# OnePlaylist

A static music player hosted on GitHub Pages. Guy in a Cube light theme, album grid, full playback controls, device downloads.

**Live:** https://music.guyinacube.com/

## Features

- Album grid with cover art
- Full album and individual track playback
- Shuffle (per-album or all tracks)
- Repeat (all / single track / off)
- Download individual tracks or full albums as ZIP
- Keyboard shortcuts
- Responsive (mobile + desktop)
- Media Session API (OS media controls / lock screen)
- Auto-generates `library.json` and cover art from MP3 ID3 tags
- GitHub Actions CI — push MP3s and the site updates

## Playback and Downloads

Album playback stays within the selected album. Shuffle All shows the actual playback order; selecting a song continues from its position in that list. Reshuffle keeps the current song and playback position. Switching shuffle off restores album/library order without interrupting the song.

Previous restarts the current song after three seconds, otherwise it goes to the preceding song. Repeat one applies to automatic track endings; manual next/previous still skip. Repeat all wraps within the selected album or playlist. With repeat off, playback stops at the end; Play starts that queue again.

Play/pause indicators stay synchronized when navigating. Volume/mute, seeking (including the start/end), keyboard controls, and supported OS media controls operate on the same player.

Fresh song links focus the requested track and prompt you to press Play, respecting browser autoplay restrictions.

Downloads save MP3 files or ZIP archives to your device. ZIP creation finishes before the download is started, and every requested song must be fetched successfully; a missing song fails the archive rather than producing an incomplete download. Missing optional cover art is disclosed. Repeat clicks are ignored while the same track or an archive is downloading. Your browser manages the final file save; there is no offline listening or in-app download storage.

## Adding Music

Create a folder per album in `media/` with your MP3 files:

```
media/
├── my-album-name/
│   ├── 01-first-track.mp3
│   ├── 02-second-track.mp3
│   └── 03-third-track.mp3
└── another-album/
    └── ...
```

The build script reads ID3 metadata (title, artist, album, year, track number, duration, embedded cover art) and generates:
- `library.json` — track/album manifest
- `media/{album}/cover.png` — extracted cover artwork

Push to GitHub and a workflow runs the build, commits the generated files, and deploys.

## Local Development

```bash
npm install          # first time only
npm run build        # generates library.json + extracts covers
npm run dev          # serves at localhost:3000
npm test             # playback, navigation, and download regression tests
npm run test:browser # real-browser audio, downloads, and mobile controls
```

The browser smoke test uses installed Microsoft Edge on Windows or Google Chrome elsewhere. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to use another Chromium executable. It serves the site locally and loads the same CDN libraries as the live player.

## File Naming

- **Album folders:** lowercase, hyphenated (`my-great-album`)
- **Track files:** any name — metadata comes from ID3 tags. Suggested: `XX-track-name.mp3`
- **Cover art:** auto-extracted from tags. A manually placed `cover.png` in the folder won't be overwritten.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Space | Play / Pause |
| → | Next track |
| ← | Previous track |
| S | Toggle shuffle |
| R | Cycle repeat mode |

Shortcuts do not override focused buttons, links, sliders, editable fields, or modifier-key combinations.

## GitHub Pages Limits

- Max file size: 100 MB
- Total site size: ~1 GB
- Bandwidth: ~100 GB/month

## Tech Stack

- [AmplitudeJS 5](https://521dimensions.com/open-source/amplitudejs) — audio playback
- [music-metadata](https://github.com/borewit/music-metadata) — ID3 tag parsing (build only)
- [Font Awesome 6](https://fontawesome.com/) — icons
- [Inter](https://fonts.google.com/specimen/Inter) — typeface
- [JSZip](https://stuk.github.io/jszip/) — album ZIP downloads
- GitHub Actions — CI/CD
- GitHub Pages — hosting

## GitHub Pages Setup

1. Repo → Settings → Pages
2. Source: Deploy from a branch
3. Branch: `main`, folder: `/ (root)`

## License

Your music, your rules. The player code is MIT.
