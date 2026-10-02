/**
 * Leitura de planilha modelo (CSV ou XLSX) para importações e carga inicial,
 * e escrita de CSV/XLSX nos relatórios (com proteção contra injeção de fórmula).
 */
import ExcelJS from 'exceljs';
import { fileTypeFromBuffer } from 'file-type';
import { AppError } from './errors.js';

export const MAX_LINHAS = 5000;

export interface Planilha { cabecalho: string[]; linhas: { numero: number; valores: Record<string, string> }[] }

const normalizar = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '_');

function parseCsv(texto: string): string[][] {
  const t = texto.replace(/^﻿/, '');
  const primeira = t.split(/\r?\n/, 1)[0] ?? '';
  const sep = (primeira.match(/;/g)?.length ?? 0) >= (primeira.match(/,/g)?.length ?? 0) ? ';' : ',';
  const linhas: string[][] = [];
  let campo = '', linha: string[] = [], aspas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (aspas) {
      if (c === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else aspas = false; } else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      linha.push(campo); linhas.push(linha); linha = []; campo = '';
      if (linhas.length > MAX_LINHAS + 1) break;
    } else campo += c;
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas.filter((l) => l.some((v) => v.trim() !== ''));
}

async function parseXlsx(buf: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const linhas: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    if (linhas.length > MAX_LINHAS + 1) return;
    const vals: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const v = cell.value;
      const s = v === null || v === undefined ? '' : typeof v === 'object' && 'text' in v ? String(v.text)
        : typeof v === 'object' && 'result' in v ? String(v.result ?? '') : v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
      vals[col - 1] = s;
    });
    linhas.push(Array.from(vals, (x) => x ?? ''));
  });
  return linhas;
}

/** Lê CSV (texto) ou XLSX (zip pelos magic bytes). Cabeçalhos normalizados (minúsculas, sem acento). */
export async function lerPlanilha(buf: Buffer): Promise<Planilha> {
  const tipo = await fileTypeFromBuffer(buf);
  let linhas: string[][];
  if (tipo?.ext === 'xlsx' || tipo?.mime === 'application/zip') linhas = await parseXlsx(buf);
  else if (!tipo) linhas = parseCsv(buf.toString('utf8'));
  else throw new AppError(415, 'Envie a planilha modelo em CSV ou XLSX', 'TIPO_INVALIDO');
  if (linhas.length < 2) throw new AppError(400, 'Planilha vazia', 'PLANILHA_VAZIA');
  if (linhas.length > MAX_LINHAS + 1) throw new AppError(413, `Planilha com mais de ${MAX_LINHAS} linhas`, 'PLANILHA_GRANDE');
  const cabecalho = linhas[0]!.map(normalizar);
  return {
    cabecalho,
    linhas: linhas.slice(1).map((vals, i) => ({
      numero: i + 2,
      valores: Object.fromEntries(cabecalho.map((h, j) => [h, (vals[j] ?? '').trim()])),
    })),
  };
}

// ---------------- escrita ----------------
/** Evita CSV/XLSX injection: células que começam com = + - @ (ou tab/CR) viram texto. */
export const celulaSegura = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return /^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s) ? `'${s}` : s;
};

export function gerarCsv(cab: string[], linhas: unknown[][]): Buffer {
  const esc = (v: unknown) => `"${celulaSegura(v).replace(/"/g, '""')}"`;
  const txt = [cab.map(esc).join(';'), ...linhas.map((l) => l.map(esc).join(';'))].join('\r\n');
  return Buffer.from('﻿' + txt, 'utf8');
}

export async function gerarXlsx(titulo: string, cab: string[], linhas: unknown[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(titulo.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
  ws.addRow(cab).font = { bold: true };
  for (const l of linhas) ws.addRow(l.map((v) => (typeof v === 'number' ? v : celulaSegura(v))));
  ws.columns.forEach((c) => { c.width = 18; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
