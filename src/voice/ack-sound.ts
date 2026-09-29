/**
 * The acknowledgement chime: the car has heard the utterance and is working
 * on it.
 *
 * The real latency from endpointing to hearing the reply is ~1–1.5 s (LLM,
 * then TTS). That silence can't be shortened, but with a chime the driver
 * knows the car heard — no repeating themselves, no glancing at the screen to
 * check.
 *
 * Two short, quiet, rising sine notes — different enough from the
 * turn-signal relay click not to be confused with it. Synthesized with Web
 * Audio for the same reason as `turn-signal-sound.ts`: not worth a request,
 * and it works offline. The tone is pure and short, so speech recognition
 * hears no words in it and doesn't cut off the turn that was just sent.
 */

let context: AudioContext | undefined

function tone(start: number, frequency: number, duration: number) {
  if (!context) return
  const oscillator = context.createOscillator()
  oscillator.type = 'sine'
  oscillator.frequency.value = frequency
  const gain = context.createGain()
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(0.12, start + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  oscillator.connect(gain).connect(context.destination)
  oscillator.start(start)
  oscillator.stop(start + duration + 0.01)
}

export function playAck() {
  context ??= new AudioContext()
  if (context.state === 'suspended') void context.resume()
  const now = context.currentTime
  tone(now, 880, 0.07)
  tone(now + 0.075, 1320, 0.09)
}
