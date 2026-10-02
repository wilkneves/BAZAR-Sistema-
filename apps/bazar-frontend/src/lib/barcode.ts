/**
 * Gerador de código de barras Code 39 em SVG (sem dependência externa).
 * Code 39 é lido por praticamente todo leitor USB em modo teclado (RNF-11).
 * Cada caractere = 9 elementos (5 barras + 4 espaços), 3 deles largos.
 */
const PATTERNS: Record<string, string> = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn', '4': 'nnnwwnnnw',
  '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw', '8': 'wnnwnnwnn', '9': 'nnwwnnwnn',
  A: 'wnnnnwnnw', B: 'nnwnnwnnw', C: 'wnwnnwnnn', D: 'nnnnwwnnw', E: 'wnnnwwnnn', F: 'nnwnwwnnn',
  G: 'nnnnnwwnw', H: 'wnnnnwwnn', I: 'nnwnnwwnn', J: 'nnnnwwwnn', K: 'wnnnnnnww', L: 'nnwnnnnww',
  M: 'wnwnnnnwn', N: 'nnnnwnnww', O: 'wnnnwnnwn', P: 'nnwnwnnwn', Q: 'nnnnnnwww', R: 'wnnnnnwwn',
  S: 'nnwnnnwwn', T: 'nnnnwnwwn', U: 'wwnnnnnnw', V: 'nwwnnnnnw', W: 'wwwnnnnnn', X: 'nwnnwnnnw',
  Y: 'wwnnwnnnn', Z: 'nwwnwnnnn', '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '*': 'nwnnwnwnn',
};

export function code39Svg(value: string, height = 50, narrow = 2): string {
  const text = `*${value.toUpperCase()}*`;
  let x = 0;
  const rects: string[] = [];
  for (const ch of text) {
    const p = PATTERNS[ch];
    if (!p) throw new Error(`Caractere não suportado no Code 39: ${ch}`);
    [...p].forEach((el, i) => {
      const w = el === 'w' ? narrow * 3 : narrow;
      if (i % 2 === 0) rects.push(`<rect x="${x}" y="0" width="${w}" height="${height}"/>`);
      x += w;
    });
    x += narrow; // espaço entre caracteres
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x} ${height}" width="${x}" height="${height}" role="img" aria-label="${value}">${rects.join('')}</svg>`;
}
