// One medium plays at a time: whatever starts pauses the one playing (audio, clips, the episode).
let playing: HTMLMediaElement | undefined;

/** Pauses whatever else plays; call when a medium starts. */
export function claimPlayback(media: HTMLMediaElement) {
  if (playing && playing !== media) playing.pause();
  playing = media;
}
