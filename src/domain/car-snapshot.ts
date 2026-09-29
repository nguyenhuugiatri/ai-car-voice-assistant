/**
 * `CarState` → a snapshot for the model to read, sent along with the utterance
 * on every turn of the agent loop.
 *
 * We don't hand over the raw `CarState`: an empty map (`doors: {}`) means "all
 * closed" only to someone who has read the comments in `car-state.ts`. The
 * model hasn't, so here every door, window and mirror is listed explicitly,
 * with units and bounds.
 *
 * Pure function — imports no store. The caller passes the state in.
 */

import {
  DOORS,
  FAN_SPEED_RANGE,
  MIRRORS,
  SEAT_HEAT_RANGE,
  TEMPERATURE_RANGE,
  type CarState,
} from './car-state'

/** Music isn't `CarState`, but when the driver asks "đang phát bài gì" ("what's playing"), they're still asking the car. */
export type MusicSnapshot = {
  title: string
  artist: string
  playing: boolean
} | null

export function snapshotCar(car: CarState, music: MusicSnapshot) {
  return {
    screen: car.screen,
    climate: {
      temperatureCelsius: car.temperature,
      temperatureRange: [TEMPERATURE_RANGE.min, TEMPERATURE_RANGE.max],
      fanSpeed: car.fanSpeed,
      fanSpeedRange: [FAN_SPEED_RANGE.min, FAN_SPEED_RANGE.max],
      seatHeat: car.seatHeat,
      seatHeatRange: [SEAT_HEAT_RANGE.min, SEAT_HEAT_RANGE.max],
      acOn: car.acOn,
      recirculationOn: car.recirculationOn,
      frontDefrostOn: car.frontDefrostOn,
      rearDefrostOn: car.rearDefrostOn,
    },
    body: {
      doorsOpen: Object.fromEntries(
        DOORS.map((door) => [door, car.doors[door] ?? false]),
      ),
      windowsOpenPercent: Object.fromEntries(
        DOORS.map((door) => [door, car.windows[door] ?? 0]),
      ),
      mirrorsFolded: Object.fromEntries(
        MIRRORS.map((mirror) => [mirror, car.mirrors[mirror] ?? false]),
      ),
      sunroofOpenPercent: car.sunroof,
      frunkOpen: car.frunkOpen,
      trunkOpen: car.trunkOpen,
      turnSignal: car.turnSignal,
      wipers: car.wipers,
    },
    music: music ?? 'no music playing',
  }
}
