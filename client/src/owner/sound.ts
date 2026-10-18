// 効果音（任意）。ファイルを使わず WebAudio で短い音を鳴らす。
// 自動再生の制限があるため、ユーザーが設定で音を有効にした後（操作の後）にだけ鳴らす。
export type SoundId = "tap" | "report" | "start" | "goal" | "win";

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

const NOTES: Record<SoundId, [number, number][]> = {
  tap: [[660, 0.05]],
  report: [
    [740, 0.08],
    [988, 0.12],
  ],
  start: [
    [523, 0.12],
    [523, 0.12],
    [784, 0.3],
  ],
  goal: [
    [784, 0.12],
    [1047, 0.25],
  ],
  win: [
    [784, 0.12],
    [988, 0.12],
    [1175, 0.12],
    [1568, 0.4],
  ],
};

export function playSound(id: SoundId) {
  const a = audio();
  if (!a) return;
  let t = a.currentTime;
  for (const [freq, dur] of NOTES[id]) {
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = "triangle";
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
    t += dur * 0.9;
  }
}
