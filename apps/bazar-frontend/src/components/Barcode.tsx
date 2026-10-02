import { code39Svg } from '../lib/barcode';

/** Código de barras Code 39 renderizado como SVG (gerado localmente, sem HTML externo). */
export function Barcode({ value, height = 44 }: { value: string; height?: number }) {
  let svg = '';
  try { svg = code39Svg(value, height); } catch { return <code>{value}</code>; }
  // svg vem exclusivamente do nosso gerador (só <rect> e atributos numéricos) — seguro para injetar.
  return <span className="barcode" dangerouslySetInnerHTML={{ __html: svg }} />;
}
