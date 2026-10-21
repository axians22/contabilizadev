// Caixa Postal da Receita (e-CAC) pelo Serpro. Quais serviços registram a ciência, conferido na documentação oficial do
// Integra Contador em 20/10/2026 (https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/
// integra-caixapostal/caixapostal/servicos/):
// - "Obter Lista de Mensagens por Contribuintes" (CAIXAPOSTAL/MSGCONTRIBUINTE61): só o cabeçalho de cada mensagem
//   (assunto, data e hora de envio, remetente, indicador de leitura, data de ciência, relevância), até 50 por página, com
//   ponteiro para a próxima. Não traz o corpo e não muda a leitura.
// - "Obter Indicador de Novas Mensagens" (CAIXAPOSTAL/INNOVAMSG63): só diz se há mensagem nova ("enquanto não for
//   aberta, continuará sendo classificada como nova"). Não usado: a lista já traz o indicador de leitura de cada uma.
// - "Obter Detalhes de uma Mensagem Específica" (CAIXAPOSTAL/MSGDETALHAMENTO62): o corpo da mensagem. A página do serviço
//   diz: "Assim como na aplicação Caixa Postal do portal e-CAC, a execução deste serviço caracteriza ciência da intimação,
//   nos termos do art. 23, § 2º, inciso III, do Decreto nº 70.235/1972." Por isso só é chamado a pedido do cliente, com a
//   confirmação explícita para a mensagem ainda não lida (abrirMensagem recusa sem ela).
import { type ClienteSerpro, type Contexto } from "./cliente.ts";

// A lista é buscada no máximo uma vez por dia sozinha (a plataforma também tem o botão Atualizar).
export const INTERVALO_DIAS = 1;
// Cada página é uma consulta cobrada: na primeira busca, até 3 páginas (150 mensagens); depois, só a primeira (as mais
// recentes) basta para achar as novas e atualizar a leitura das recentes.
export const PAGINAS_NA_PRIMEIRA_BUSCA = 3;

export const SERVICO_DA_LISTA = "MSGCONTRIBUINTE61";
export const SERVICO_DO_CONTEUDO = "MSGDETALHAMENTO62"; // registra a ciência

type Valor = string | number | undefined;

type MensagemLista = {
  isn?: Valor;
  assuntoModelo?: string;
  valorParametroAssunto?: string;
  dataEnvio?: Valor;
  horaEnvio?: Valor;
  indicadorLeitura?: Valor;
  dataCiencia?: Valor;
  dataValidade?: Valor;
  relevancia?: Valor;
  descricaoOrigem?: string;
};

type PaginaLista = { indicadorUltimaPagina?: string; ponteiroProximaPagina?: Valor; listaMensagens?: MensagemLista[] };

export type MensagemCaixa = {
  isn: string;
  assunto: string;
  origem: string;
  enviadaEm: string | null; // "AAAA-MM-DDThh:mm:ss"
  lidaNaReceita: boolean;
  cienciaEm: string | null;
  validaAte: string | null;
  relevante: boolean;
};

const texto = (v: Valor | null) => (v === undefined || v === null ? undefined : String(v));

// "20250408" + "092949" -> "2025-04-08T09:29:49" (a documentação dá a hora como número: 92949 = 09:29:49)
export const dataHora = (d?: Valor, h?: Valor) => {
  const dia = texto(d);
  if (!dia || dia.length !== 8) return null;
  const hora = texto(h)?.padStart(6, "0");
  return `${dia.slice(0, 4)}-${dia.slice(4, 6)}-${dia.slice(6, 8)}${hora && hora.length === 6 ? `T${hora.slice(0, 2)}:${hora.slice(2, 4)}:${hora.slice(4, 6)}` : ""}`;
};

const assunto = (m: MensagemLista) =>
  (m.assuntoModelo ?? "").replace(/\+\+[A-Z0-9]+\+\+/g, m.valorParametroAssunto ?? "").replace(/\s+/g, " ").trim();

const paginas = (dados: unknown): PaginaLista[] => (dados as { conteudo?: PaginaLista[] } | undefined)?.conteudo ?? [];

export function lerListaDeMensagens(dados: unknown): MensagemCaixa[] {
  return paginas(dados)
    .flatMap((c) => c.listaMensagens ?? [])
    .filter((m) => texto(m.isn))
    .map((m) => ({
      isn: texto(m.isn)!,
      assunto: assunto(m),
      origem: m.descricaoOrigem ?? "",
      enviadaEm: dataHora(m.dataEnvio, m.horaEnvio),
      lidaNaReceita: texto(m.indicadorLeitura) === "1",
      cienciaEm: dataHora(m.dataCiencia),
      validaAte: dataHora(m.dataValidade),
      relevante: texto(m.relevancia) === "2",
    }));
}

// O ponteiro da próxima página, ou null na última.
export function proximaPagina(dados: unknown): string | null {
  const [pagina] = paginas(dados);
  if (!pagina || pagina.indicadorUltimaPagina !== "N") return null;
  return texto(pagina.ponteiroProximaPagina) ?? null;
}

// A lista (só os cabeçalhos; nunca o serviço que registra a ciência), da página inicial (as mais recentes) até `paginas`
// páginas. Mensagem repetida entre páginas entra uma vez. Resposta fora de 2xx vira erro (nada é apagado por engano).
export async function listarMensagens(cliente: ClienteSerpro, ctx: Contexto, opcoes: { paginas?: number } = {}): Promise<MensagemCaixa[]> {
  const maximo = Math.max(1, opcoes.paginas ?? 1);
  const vistas = new Map<string, MensagemCaixa>();
  let ponteiro: string | null = null;
  for (let pagina = 0; pagina < maximo; pagina++) {
    const dados: Record<string, string> = { statusLeitura: "0", indicadorPagina: ponteiro ? "1" : "0" };
    if (ponteiro) dados.ponteiroPagina = ponteiro;
    const r = await cliente.chamar(
      "Consultar",
      { idSistema: "CAIXAPOSTAL", idServico: SERVICO_DA_LISTA, versaoSistema: "1.0", dados },
      "Listar as mensagens da Caixa Postal da Receita (só o cabeçalho, sem abrir o conteúdo)",
      ctx,
    );
    if (r.status < 200 || r.status >= 300) {
      throw new Error(`Lista da Caixa Postal recusada (HTTP ${r.status}): ${r.mensagens.map((m) => `${m.codigo}: ${m.texto}`).join(" | ")}`);
    }
    for (const m of lerListaDeMensagens(r.dados)) if (!vistas.has(m.isn)) vistas.set(m.isn, m);
    ponteiro = proximaPagina(r.dados);
    if (!ponteiro) break;
  }
  return [...vistas.values()];
}

// Texto (HTML da Receita) da mensagem, com as variáveis ++1++, ++2++... preenchidas.
export function lerConteudo(dados: unknown): string {
  const item = ((dados as { conteudo?: { corpoModelo?: string; variaveis?: string[] }[] } | undefined)?.conteudo ?? [])[0];
  if (!item?.corpoModelo) throw new Error("A Receita não devolveu o conteúdo da mensagem.");
  const variaveis = item.variaveis ?? [];
  return item.corpoModelo.replace(/\+\+(\d+)\+\+/g, (_, n) => variaveis[Number(n) - 1] ?? "");
}

// Abre o conteúdo de uma mensagem. Atenção: pela Receita, isso dá ciência da intimação; mensagem ainda não lida
// só abre com a confirmação do cliente.
export async function abrirMensagem(
  cliente: ClienteSerpro,
  ctx: Contexto,
  mensagem: Pick<MensagemCaixa, "isn" | "lidaNaReceita">,
  confirmado: boolean,
): Promise<string> {
  if (!mensagem.lidaNaReceita && !confirmado) throw new Error("Abrir a mensagem dá ciência na Receita: confirme antes de abrir.");
  const r = await cliente.chamar(
    "Consultar",
    { idSistema: "CAIXAPOSTAL", idServico: SERVICO_DO_CONTEUDO, versaoSistema: "1.0", dados: { isn: mensagem.isn } },
    `Abrir a mensagem ${mensagem.isn} da Caixa Postal, a pedido do cliente (dá ciência na Receita)`,
    ctx,
  );
  return lerConteudo(r.dados);
}

// Hora de buscar a lista de novo (uma vez por dia).
export function buscarListaDeNovo(ultimaBusca: Date | null, agora = new Date()): boolean {
  return !ultimaBusca || agora.getTime() - ultimaBusca.getTime() >= INTERVALO_DIAS * 24 * 60 * 60 * 1000;
}
