# OnePlaylist

A static music player hosted on GitHub Pages. Dark theme, album grid, full playback controls, downloads.

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
```

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
