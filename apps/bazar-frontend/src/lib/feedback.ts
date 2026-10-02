/** Feedback sonoro na leitura/recusa de código (diretriz de UX do PDV). */
let ctx: AudioContext | null = null;
export function beep(kind: 'ok' | 'erro') {
  try {
    ctx ??= new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = kind === 'ok' ? 1200 : 220;
    gain.gain.value = 0.08;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (kind === 'ok' ? 0.08 : 0.3));
  } catch { /* áudio indisponível: segue só o feedback visual */ }
}
