/**
 * The reply is generated from `ToolResult` **by code**, not written by the
 * LLM.
 *
 * This is a pure `switch` function: the same `ToolResult` always yields the
 * same sentence, whether the command came from voice or from a finger. The
 * touch path and the voice loop call the same function; neither rewrites it.
 */

import {
  DOORS,
  FAN_SPEED_RANGE,
  MIRRORS,
  SEAT_HEAT_RANGE,
  TEMPERATURE_RANGE,
  ZONES,
  type DoorId,
  type DoorStates,
  type MirrorId,
  type TurnSignal,
  type WindowPositions,
  type WiperMode,
  type Zone,
} from './car-state'
import type { OpeningPart, ToolResult } from './tool-result'

const ZONE_LABEL: Record<Zone, string> = {
  driver: 'bên lái',
  passenger: 'bên phụ',
}

function zonePhrase(zones: Zone[]): string {
  if (zones.length !== 1) return 'cả xe'
  return ZONE_LABEL[zones[0]]
}

const FEATURE_LABEL = {
  ac: 'điều hoà',
  recirculation: 'lấy gió trong',
  frontDefrost: 'sấy kính trước',
  rearDefrost: 'sấy kính sau',
} as const

const SCREEN_LABEL = {
  home: 'menu',
  climate: 'màn hình điều hoà',
  settings: 'phần cài đặt',
} as const

/* ---------------------------------------------------------------------- */
/* Body                                                                   */
/* ---------------------------------------------------------------------- */

const DOOR_POSITION: Record<DoorId, string> = {
  frontLeft: 'trước trái',
  frontRight: 'trước phải',
  rearLeft: 'sau trái',
  rearRight: 'sau phải',
}

const MIRROR_POSITION: Record<MirrorId, string> = {
  left: 'trái',
  right: 'phải',
}

/**
 * The part's name, and **the verb that goes with it**.
 *
 * Vietnamese doesn't let you share one verb: windows take "hạ"/"đóng"
 * (lower/close), doors take "mở"/"đóng" (open/close), mirrors take
 * "bung"/"gập" (unfold/fold). Rendering all three as "mở"/"đóng" for
 * tidiness would make every sentence grammatical but none of them sound like
 * something the driver would say.
 */
const OPENING_WORDS: Record<
  OpeningPart,
  { label: string; open: string; close: string }
> = {
  door: { label: 'cửa', open: 'mở', close: 'đóng' },
  window: { label: 'kính', open: 'hạ', close: 'đóng' },
  mirror: { label: 'gương', open: 'bung', close: 'gập' },
  sunroof: { label: 'cửa sổ trời', open: 'mở', close: 'đóng' },
  frunk: { label: 'cốp trước', open: 'mở', close: 'đóng' },
  trunk: { label: 'cốp sau', open: 'mở', close: 'đóng' },
}

/**
 * "cả bốn" ("all four") instead of listing four positions: this sentence is
 * also **read aloud**, and "kính trước trái, trước phải, sau trái, sau phải"
 * ("front-left, front-right, rear-left, rear-right window") is four seconds
 * of the driver sitting through something they just said.
 */
function openingPlace(result: {
  part: OpeningPart
  targets: Array<DoorId | MirrorId>
}): string {
  const { part, targets } = result
  if (targets.length === 0) return ''
  if (part === 'mirror') {
    if (targets.length === MIRRORS.length) return ' cả hai bên'
    return ` ${MIRROR_POSITION[targets[0] as MirrorId]}`
  }
  if (targets.length === DOORS.length) return ' cả bốn'
  return ` ${DOOR_POSITION[targets[0] as DoorId]}`
}

const SIGNAL_LABEL: Record<Exclude<TurnSignal, 'off'>, string> = {
  left: 'xi nhan trái',
  right: 'xi nhan phải',
  hazard: 'đèn khẩn cấp',
}

const WIPER_PHRASE: Record<Exclude<WiperMode, 'off'>, string> = {
  intermittent: 'chế độ ngắt quãng',
  low: 'tốc độ chậm',
  high: 'tốc độ nhanh',
}

/**
 * `getDay()` returns 0 for Sunday, so the array starts at Sunday — not Monday.
 *
 * Hand-written rather than `toLocaleDateString('vi-VN')`: `Intl` returns
 * "Thứ Tư" ("Wednesday") with a capital T, which is a Vietnamese spelling
 * error mid-sentence. Also, locale data depends on the browser, and this
 * string is read aloud too — not worth letting a machine missing the `vi`
 * locale turn the answer into English.
 */
const WEEKDAY = [
  'Chủ nhật',
  'thứ Hai',
  'thứ Ba',
  'thứ Tư',
  'thứ Năm',
  'thứ Sáu',
  'thứ Bảy',
] as const

/** "14 giờ 30", "14 giờ đúng" ("14:30", "14:00 sharp") — 24-hour, because that's how the car clock displays it. */
function clockPhrase(at: Date): string {
  const hours = at.getHours()
  const minutes = at.getMinutes()
  return minutes === 0 ? `${hours} giờ đúng` : `${hours} giờ ${minutes}`
}

/** "thứ Tư, ngày 10 tháng 9 năm 2026" ("Wednesday, 10 September 2026"). */
function datePhrase(at: Date): string {
  return (
    `${WEEKDAY[at.getDay()]}, ngày ${at.getDate()} ` +
    `tháng ${at.getMonth() + 1} năm ${at.getFullYear()}`
  )
}

function temperatureSentence(
  result: Extract<ToolResult, { kind: 'numeric' }>,
): string {
  const where = zonePhrase(result.zones)
  if (result.clamped) {
    // Compare against the real bound, not `to` against `from`: asking for
    // warmer while already at 30° gives `to === from`, and the old comparison
    // read that as "tối thiểu" ("minimum").
    const bound = result.to >= TEMPERATURE_RANGE.max ? 'đa' : 'thiểu'
    if (result.to === result.from) {
      return `Nhiệt độ ${where} đã ở mức tối ${bound} — ${result.to} độ`
    }
    const up = result.to > result.from
    return `Đã ${up ? 'tăng' : 'giảm'} nhiệt độ ${where} ${up ? 'lên' : 'xuống'} mức tối ${bound} — ${result.to} độ`
  }
  if (result.to === result.from) return `Nhiệt độ ${where} vẫn ${result.to} độ`
  const up = result.to > result.from
  return `Đã ${up ? 'tăng' : 'giảm'} nhiệt độ ${where} ${up ? 'lên' : 'xuống'} ${result.to} độ`
}

export function describeResult(result: ToolResult): string {
  switch (result.kind) {
    case 'numeric': {
      if (result.field === 'temperature') {
        const sentence = temperatureSentence(result)
        if (!result.acTurnedOn) return sentence
        return `Đã bật điều hoà, ${sentence[0].toLocaleLowerCase('vi')}${sentence.slice(1)}`
      }

      if (result.field === 'fanSpeed') {
        if (result.to === FAN_SPEED_RANGE.min) return 'Đã tắt quạt'
        if (result.clamped) return `Quạt đã ở mức tối đa — mức ${result.to}`
        if (result.to === result.from) return `Quạt vẫn ở mức ${result.to}`
        const up = result.to > result.from
        return `Đã ${up ? 'tăng' : 'giảm'} quạt ${up ? 'lên' : 'xuống'} mức ${result.to}`
      }

      const where = zonePhrase(result.zones)
      if (result.to === SEAT_HEAT_RANGE.min) return `Đã tắt sưởi ghế ${where}`
      return `Đã đặt sưởi ghế ${where} ở mức ${result.to}`
    }

    case 'toggle': {
      const label = FEATURE_LABEL[result.feature]
      if (result.alreadySet)
        return `${label} vốn đã ${result.on ? 'bật' : 'tắt'}`
      return `Đã ${result.on ? 'bật' : 'tắt'} ${label}`
    }

    case 'navigation':
      if (result.from === result.to)
        return `Đang ở ${SCREEN_LABEL[result.to]} rồi`
      return `Đã mở ${SCREEN_LABEL[result.to]}`

    case 'opening': {
      const words = OPENING_WORDS[result.part]
      const verb = result.open ? words.open : words.close
      const place = openingPlace(result)
      if (result.alreadySet) {
        return `${words.label}${place} vốn đã ${result.open ? words.open : words.close} rồi`
      }
      return `Đã ${verb} ${words.label}${place}`
    }

    case 'turnSignal': {
      if (result.to === 'off') {
        if (result.from === 'off') return 'Xi nhan vốn đã tắt'
        return `Đã tắt ${SIGNAL_LABEL[result.from]}`
      }
      if (result.from === result.to) {
        return `${SIGNAL_LABEL[result.to]} vốn đang bật`
      }
      return `Đã bật ${SIGNAL_LABEL[result.to]}`
    }

    case 'wipers': {
      if (result.to === 'off') {
        return result.from === 'off' ? 'Gạt mưa vốn đã tắt' : 'Đã tắt gạt mưa'
      }
      if (result.from === result.to) {
        return `Gạt mưa vốn đang ở ${WIPER_PHRASE[result.to]}`
      }
      return `Đã cho gạt mưa chạy ${WIPER_PHRASE[result.to]}`
    }

    case 'time': {
      const { what, at } = result
      if (what === 'time') return `Bây giờ là ${clockPhrase(at)}`
      if (what === 'date') return `Hôm nay là ${datePhrase(at)}`
      return `Bây giờ là ${clockPhrase(at)}, ${datePhrase(at)}`
    }

    case 'music': {
      const { action, alreadySet, track } = result
      if (action === 'off')
        return alreadySet ? 'Nhạc vốn đã tắt' : 'Đã tắt nhạc'
      if (action === 'pause') {
        return alreadySet ? 'Nhạc vốn đang dừng' : 'Đã tạm dừng nhạc'
      }
      if (!track) return 'Chưa có bài nào để phát'
      if (action === 'play') {
        return alreadySet
          ? `Đang phát ${track.title} rồi`
          : `Đang phát ${track.title} của ${track.artist}`
      }
      // `previous` once the track has played for a while only rewinds to the
      // start of the track — see `RESTART_THRESHOLD_SEC` in `music-store`.
      if (alreadySet) return `Phát lại ${track.title} từ đầu`
      return `Chuyển sang ${track.title} của ${track.artist}`
    }

    case 'musicSearchFailed':
      return result.problem

    case 'spoken':
      return result.reason

    case 'rejected':
      // `engine` is a failure of the pipeline (network, timeout, broken model),
      // not of the utterance. Saying "chưa hiểu ý" ("didn't understand") makes
      // the driver repeat themselves verbatim, and repeating doesn't fix a
      // lost connection.
      if (result.toolName === 'engine') {
        return 'Xin lỗi, hệ thống đang gặp sự cố, bạn thử lại sau nhé'
      }
      return 'Xin lỗi, tôi chưa hiểu ý'
  }
}

/* ---------------------------------------------------------------------- */
/* Descriptions for screen readers                                        */
/* ---------------------------------------------------------------------- */

/*
 * These describe **the screen**, so they follow the on-screen language
 * (English), not the voice. That's why they have their own labels below: the
 * Vietnamese maps above feed only the spoken reply, and must not change when
 * the screen copy does.
 */

const SCREEN_ZONE: Record<Zone, string> = {
  driver: 'Driver',
  passenger: 'Passenger',
}

const SCREEN_DOOR: Record<DoorId, string> = {
  frontLeft: 'front left',
  frontRight: 'front right',
  rearLeft: 'rear left',
  rearRight: 'rear right',
}

const SCREEN_SIGNAL: Record<Exclude<TurnSignal, 'off'>, string> = {
  left: 'left turn signal',
  right: 'right turn signal',
  hazard: 'hazard lights',
}

const SCREEN_WIPER: Record<Exclude<WiperMode, 'off'>, string> = {
  intermittent: 'intermittent',
  low: 'slow',
  high: 'fast',
}

/**
 * A description of the top-down car view (`CarTopView`) for screen readers.
 *
 * Only reads out what's **on or open** — except the A/C, fan and
 * temperature, which are always read because they're the key information.
 * Ten "off" items in a row is ten seconds of hearing nothing useful.
 * Sentences are split with periods so the reader pauses.
 */
export function describeCarView(view: {
  acOn: boolean
  doors: DoorStates
  fanSpeed: number
  frontDefrostOn: boolean
  frunkOpen: boolean
  rearDefrostOn: boolean
  recirculationOn: boolean
  roofHidden: boolean
  seatHeat: Record<Zone, number>
  sunroof: number
  temperature: Record<Zone, number>
  trunkOpen: boolean
  turnSignal: TurnSignal
  windows: WindowPositions
  wipers: WiperMode
}): string {
  const heat = (level: number) =>
    level === 0 ? 'seat heating off' : `seat heating level ${level}`

  const openDoors = DOORS.filter((door) => view.doors[door])
  const openings = [
    ...(openDoors.length === DOORS.length
      ? ['all four doors open']
      : openDoors.map((door) => `${SCREEN_DOOR[door]} door open`)),
    ...DOORS.flatMap((door) => {
      const position = view.windows[door] ?? 0
      return position > 0
        ? [`${SCREEN_DOOR[door]} window ${position}% open`]
        : []
    }),
    ...(view.sunroof > 0 ? [`sunroof ${view.sunroof}% open`] : []),
    ...(view.frunkOpen ? ['frunk open'] : []),
    ...(view.trunkOpen ? ['trunk open'] : []),
  ]

  const defrost = [
    ...(view.frontDefrostOn ? ['front defrost'] : []),
    ...(view.rearDefrostOn ? ['rear defrost'] : []),
  ]

  const sentences = [
    'Car seen from above',
    view.roofHidden ? 'Cabin view, roof hidden' : '',
    [
      `A/C ${view.acOn ? 'on' : 'off'}`,
      view.recirculationOn ? 'recirculation on' : 'fresh air',
      view.fanSpeed === 0 ? 'fan off' : `fan level ${view.fanSpeed}`,
    ].join(', '),
    ...ZONES.map(
      (zone) =>
        `${SCREEN_ZONE[zone]} ${view.temperature[zone]} degrees, ${heat(view.seatHeat[zone])}`,
    ),
    defrost.length > 0 ? `${defrost.join(', ')} on` : '',
    openings.join(', '),
    view.wipers === 'off' ? '' : `wipers ${SCREEN_WIPER[view.wipers]}`,
    view.turnSignal === 'off'
      ? ''
      : `${SCREEN_SIGNAL[view.turnSignal]} blinking`,
  ]

  return sentences
    .filter(Boolean)
    .map((sentence) => sentence[0].toUpperCase() + sentence.slice(1))
    .join('. ')
    .concat('.')
}

/**
 * Label for the seat-heating button. The screen reader announces the "button"
 * role on its own, so no "tap to…" — except at the top level, because pressing
 * again turns it **off** rather than up, which users can't guess.
 */
export function describeSeatHeatButton(zone: Zone, level: number): string {
  const seat = `${SCREEN_ZONE[zone]} seat heating`
  if (level === 0) return `${seat}, off`
  const status = `${seat}, level ${level} of ${SEAT_HEAT_RANGE.max}`
  return level === SEAT_HEAT_RANGE.max ? `${status}, press to turn off` : status
}
