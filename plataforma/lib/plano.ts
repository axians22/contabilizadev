// Lê o plano.txt da raiz do projeto e transforma em dados para a página /admin/plano.
// A página lê o arquivo a cada acesso (ela exige sessão, então não é gerada no build); o plano.txt é a única fonte.
import fs from "node:fs";
import path from "node:path";

export type Passo = { numero: number; texto: string; subitens: string[] };
export type Parte = { numero: number; nome: string; feito: boolean; nota: string | null; passos: Passo[] };
export type Lista = { titulo: string; itens: string[] };

// Seção SEGURANÇA (a auditoria): cada item é "- [Gravidade] texto", com a continuação recuada nas linhas seguintes;
// o item resolvido termina com "[FEITO em DD/MM/AAAA: resumo]".
export const GRAVIDADES = ["Alta", "Média", "Baixa", "Decisão"] as const;
export type Gravidade = (typeof GRAVIDADES)[number];
export type ItemDeSeguranca = { gravidade: Gravidade | null; texto: string; feito: { data: string; resumo: string | null } | null };
export type Seguranca = { introducao: string; itens: ItemDeSeguranca[] };

export type Plano = { titulo: string; introducao: string[]; partes: Parte[]; listas: Lista[]; seguranca: Seguranca | null };

const ARQUIVO = path.join(process.cwd(), "..", "plano.txt");

export function lerPlano(): Plano {
  return interpretarPlano(fs.readFileSync(ARQUIVO, "utf8"));
}

const MAIUSCULAS = "A-ZÇÃÕÁÉÍÓÚÂÊÔÀ0-9";
// Título de lista: maiúsculas ("DECISÕES TOMADAS", "PRIMEIRA VERSÃO (MVP) ATENDE SÓ"), com um complemento opcional em
// minúsculas entre parênteses no fim ("BACKLOG (fora do plano por enquanto)").
const TITULO = new RegExp(`^[${MAIUSCULAS}][${MAIUSCULAS} ()\\-]*?(?:\\s+\\([^()]*\\))?$`);
const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const GRAVIDADE_DE: Record<string, Gravidade> = Object.fromEntries(GRAVIDADES.map((g) => [semAcento(g), g]));

// "[Alta] texto … [FEITO em 21/10/2026: resumo]" -> gravidade, texto e o feito (o resumo é opcional).
export function itemDeSeguranca(bruto: string): ItemDeSeguranca {
  let texto = bruto.trim();
  let gravidade: Gravidade | null = null;
  const marca = texto.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (marca && GRAVIDADE_DE[semAcento(marca[1].trim())]) {
    gravidade = GRAVIDADE_DE[semAcento(marca[1].trim())];
    texto = marca[2];
  }
  let feito: ItemDeSeguranca["feito"] = null;
  const fim = texto.match(/^(.*?)\s*\[FEITO em (\d{2}\/\d{2}\/\d{4})(?::\s*([^\]]*?))?\s*\]$/i);
  if (fim) {
    texto = fim[1];
    feito = { data: fim[2], resumo: fim[3] || null };
  }
  return { gravidade, texto: texto.trim(), feito };
}

// Contagem do topo da aba Segurança: os abertos por gravidade (na ordem de GRAVIDADES) e os feitos à parte.
export function contagemDeSeguranca(itens: ItemDeSeguranca[]): { porGravidade: { gravidade: Gravidade; total: number }[]; feitos: number } {
  const abertos = itens.filter((i) => !i.feito);
  return {
    porGravidade: GRAVIDADES.map((gravidade) => ({ gravidade, total: abertos.filter((i) => i.gravidade === gravidade).length })),
    feitos: itens.length - abertos.length,
  };
}

// As abas da página /admin/plano; a ativa vem do endereço (?aba=seguranca), e qualquer outro valor cai em Plano.
export const ABAS_DO_PLANO = [
  { id: "plano", nome: "Plano", href: "/admin/plano" },
  { id: "seguranca", nome: "Segurança", href: "/admin/plano?aba=seguranca" },
] as const;
export type AbaDoPlano = (typeof ABAS_DO_PLANO)[number]["id"];
export const abaDoPlano = (valor: string | string[] | undefined): AbaDoPlano => (valor === "seguranca" ? "seguranca" : "plano");

// Títulos do plano vêm em maiúsculas: "NÚCLEO (SEM TELA)" -> "Núcleo (sem tela)", mantendo siglas e nomes (só a
// página /admin/plano, interna, usa: pode citar o fornecedor).
const NOMES: Record<string, string> = { mvp: "MVP", esocial: "eSocial", serpro: "Serpro", cnpj: "CNPJ" };
export const capitalizar = (texto: string) =>
  texto
    .toLowerCase()
    .replace(/[a-zçãõáéíóúâêô]+/g, (p) => NOMES[p] ?? p)
    .replace(/^./, (c) => c.toUpperCase());

export function interpretarPlano(conteudo: string): Plano {
  const linhas = conteudo.split(/\r?\n/);
  const plano: Plano = { titulo: linhas[0]?.trim() ?? "Plano", introducao: [], partes: [], listas: [], seguranca: null };
  let parte: Parte | null = null;
  let lista: Lista | null = null;
  let passo: Passo | null = null;
  let seguranca: { introducao: string[]; itens: string[] } | null = null;
  const fecharSeguranca = () => {
    if (seguranca) plano.seguranca = { introducao: seguranca.introducao.join(" "), itens: seguranca.itens.map(itemDeSeguranca) };
    seguranca = null;
  };

  for (const bruta of linhas.slice(1)) {
    const linha = bruta.trimEnd();
    if (!linha.trim() || /^=+$/.test(linha.trim())) {
      passo = null;
      continue;
    }
    // "PARTE 0 - PREPARAÇÃO  [FEITO em 16/10/2026: ...]"
    const cabecalho = linha.match(/^PARTE (\d+) - (.+?)(?:\s+\[(.+)\])?$/);
    if (cabecalho) {
      fecharSeguranca();
      const status = cabecalho[3] ?? null;
      parte = { numero: Number(cabecalho[1]), nome: cabecalho[2].trim(), feito: /^feito/i.test(status ?? ""), nota: status, passos: [] };
      plano.partes.push(parte);
      lista = null;
      passo = null;
      continue;
    }
    // Títulos em maiúsculas depois das partes viram listas ("DECISÕES TOMADAS", "BACKLOG (fora do plano …)"); a
    // SEGURANÇA vira a seção própria da aba Segurança.
    if (TITULO.test(linha) && plano.partes.length > 0) {
      fecharSeguranca();
      parte = null;
      passo = null;
      lista = null;
      if (semAcento(linha.trim()) === "seguranca") seguranca = { introducao: [], itens: [] };
      else {
        lista = { titulo: linha.trim(), itens: [] };
        plano.listas.push(lista);
      }
      continue;
    }
    if (seguranca) {
      const item = linha.match(/^-\s+(.*)$/);
      if (item) seguranca.itens.push(item[1].trim());
      else if (seguranca.itens.length) seguranca.itens[seguranca.itens.length - 1] += ` ${linha.trim()}`;
      else seguranca.introducao.push(linha.trim());
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
  fecharSeguranca();
  return plano;
}
