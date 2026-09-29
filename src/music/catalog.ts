/**
 * The default playlist — what's in the car before anyone gets to search for a
 * song.
 *
 * All official MVs, double-checked via oEmbed when added. If a channel owner
 * later disables embedding for a track, the player reports error `101`/`150`
 * and the store skips ahead on its own, so one broken entry doesn't stop the
 * music.
 */

export type MusicTrack = {
  /** YouTube video id, 11 characters. */
  id: string
  title: string
  artist: string
}

export const DEFAULT_PLAYLIST: MusicTrack[] = [
  { id: 'KKQl-pIRQMY', title: 'Photograph', artist: 'Ed Sheeran' },
  { id: 'ddaEtFOsFeM', title: 'Bài Này Chill Phết', artist: 'Đen ft. MIN' },
  { id: 'F5tS5m86bOI', title: 'Lạ Lùng', artist: 'Vũ.' },
  {
    id: 'UCXao7aTDQM',
    title: 'Tháng Tư Là Lời Nói Dối Của Em',
    artist: 'Hà Anh Tuấn',
  },
  { id: 'T0sHaz4H9MQ', title: 'Vùng Ký Ức', artist: 'Chillies' },
]

/**
 * Cover art comes from the video thumbnail. `mqdefault` (320×180) is the
 * smallest size without black letterbox bars — `default` 120×90 has them — and
 * the 48px cover tile only needs a center crop via `object-cover`.
 */
export function artworkUrl(id: string) {
  return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`
}
