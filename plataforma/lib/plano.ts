// Lê o plano.txt da raiz do projeto e transforma em dados para a página /admin/plano.
// A página lê o arquivo a cada acesso (ela exige sessão, então não é gerada no build); o plano.txt é a única fonte.
import fs from "node:fs";
import path from "node:path";

export type Passo = { numero: number; texto: string; subitens: string[] };
export type Parte = { numero: number; nome: string; feito: boolean; nota: string | null; passos: Passo[] };
export type Lista = { titulo: string; itens: string[] };
export type Plano = { titulo: string; introducao: string[]; partes: Parte[]; listas: Lista[] };

const ARQUIVO = path.join(process.cwd(), "..", "plano.txt");

export function lerPlano(): Plano {
  const linhas = fs.readFileSync(ARQUIVO, "utf8").split(/\r?\n/);
  const plano: Plano = { titulo: linhas[0]?.trim() ?? "Plano", introducao: [], partes: [], listas: [] };
  let parte: Parte | null = null;
  let lista: Lista | null = null;
  let passo: Passo | null = null;

  for (const bruta of linhas.slice(1)) {
    const linha = bruta.trimEnd();
    if (!linha.trim() || /^=+$/.test(linha.trim())) {
      passo = null;
      continue;
    }
    // "PARTE 0 - PREPARAÇÃO  [FEITO em 16/10/2026: ...]"
    const cabecalho = linha.match(/^PARTE (\d+) - (.+?)(?:\s+\[(.+)\])?$/);
    if (cabecalho) {
      const status = cabecalho[3] ?? null;
      parte = { numero: Number(cabecalho[1]), nome: cabecalho[2].trim(), feito: /^feito/i.test(status ?? ""), nota: status, passos: [] };
      plano.partes.push(parte);
      lista = null;
      passo = null;
      continue;
    }
    // Títulos em maiúsculas depois das partes viram listas ("DECISÕES PENDENTES", "PRIMEIRA VERSÃO …").
    if (/^[A-ZÇÃÕÁÉÍÓÚÂÊÔ0-9 ()\-]+$/.test(linha) && linha === linha.toUpperCase() && plano.partes.length > 0) {
      lista = { titulo: linha.trim(), itens: [] };
      plano.listas.push(lista);
      parte = null;
      passo = null;
      continue;
    }
    const numerado = linha.match(/^\s*(\d+)\.\s+(.*)$/);
    if (parte && numerado) {
      passo = { numero: Number(numerado[1]), texto: numerado[2].trim(), subitens: [] };
      parte.passos.push(passo);
      continue;
    }
    if (parte && passo) {
      // Linha recuada: subitem ("- nucleo/ …") ou continuação do texto do passo.
      const sub = linha.trim().match(/^-\s+(.*)$/);
      if (sub) passo.subitens.push(sub[1].replace(/\s{2,}/g, " — "));
      else if (passo.subitens.length) passo.subitens[passo.subitens.length - 1] += ` ${linha.trim()}`;
      else passo.texto += ` ${linha.trim()}`;
      continue;
    }
    if (lista) {
      const item = linha.match(/^-\s+(.*)$/);
      if (item) lista.itens.push(item[1].trim());
      else if (lista.itens.length) lista.itens[lista.itens.length - 1] += ` ${linha.trim()}`;
      continue;
    }
    // Introdução: guarda o recuo, para a página juntar a continuação de um item ao próprio item.
    if (!parte) plano.introducao.push(linha);
  }
  return plano;
}
