/**
 * Turn signal relay sound: a "tick" when the lamp lights, a lower "tock" when
 * it goes dark — two distinct sounds like a real relay, so you can hear the
 * rhythm without looking.
 *
 * Synthesized with Web Audio (a snippet of white noise through a bandpass
 * filter) rather than loading an audio file: 30 ms of click isn't worth a
 * request, and it works offline. The off sound is *scheduled* on the audio
 * clock as soon as the lamp lights, so the two sounds are always exactly half
 * a period apart even when the main thread is busy.
 */

let context: AudioContext | undefined
let noise: AudioBuffer | undefined

function audio() {
  context ??= new AudioContext()
  if (context.state === 'suspended') void context.resume()
  if (!noise) {
    noise = context.createBuffer(
      1,
      context.sampleRate * 0.03,
      context.sampleRate,
    )
    const data = noise.getChannelData(0)
    for (let index = 0; index < data.length; index += 1) {
      data[index] = Math.random() * 2 - 1
    }
  }
  return { context, noise }
}

function click(time: number, frequency: number, volume: number) {
  const { context, noise } = audio()
  const source = context.createBufferSource()
  source.buffer = noise
  const filter = context.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = frequency
  filter.Q.value = 1.4
  const gain = context.createGain()
  gain.gain.setValueAtTime(volume, time)
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.028)
  source.connect(filter).connect(gain).connect(context.destination)
  source.start(time)
  source.stop(time + 0.03)
}

/** Call each time the lamp lights up: plays the "tick" now and schedules the "tock" half a period later. */
export function playRelay(periodMs: number) {
  const now = audio().context.currentTime
  click(now, 2600, 0.22)
  click(now + periodMs / 2000, 1500, 0.16)
}
