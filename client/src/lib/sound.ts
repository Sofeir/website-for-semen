/**
 * Звук уведомления в открытом сервисе. Играет «колокольчик» из трёх нот, который собирается прямо в браузере:
 * файлов подгружать не нужно, громкость заметная. Включён по умолчанию, выключается в профиле.
 */
const KEY = 'sd-notify-sound';

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // память браузера недоступна: звук остаётся включённым
  }
}

let ctx: AudioContext | null = null;
let lastPlayed = 0;

/** Три звонких ноты подряд. Не чаще раза в 1,5 секунды, чтобы пачка уведомлений не трещала. */
export function playNotifySound(force = false) {
  if (!force && !soundEnabled()) return;
  const now = Date.now();
  if (!force && now - lastPlayed < 1500) return;
  lastPlayed = now;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ctx ??= new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
    const audio = ctx;
    const t0 = audio.currentTime + 0.02;
    // ми, соль, до: восходящий короткий мотив, хорошо слышный в шумном помещении
    [659.25, 783.99, 1046.5].forEach((freq, i) => {
      const start = t0 + i * 0.16;
      for (const [mul, vol] of [
        [1, 0.5],
        [2, 0.18],
      ] as const) {
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq * mul;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(vol, start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
        osc.connect(gain).connect(audio.destination);
        osc.start(start);
        osc.stop(start + 0.55);
      }
    });
  } catch {
    // звук не получился (например, браузер ещё не разрешил): всплывающее окно всё равно показано
  }
}
