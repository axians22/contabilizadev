// Assistente de cadastro da empresa (/empresas/nova), uma etapa por tela: as etapas, quando dá para avançar ou voltar
// e o que dizer ao cliente em cada uma (inclusive o que fazer quando ainda não atendemos). Só regras, sem tela nem
// banco: a tela usa o redutor daqui e as ações do servidor fazem a consulta, o cadastro (cadastro.ts) e preparam a
// autorização (lib/termo/termo.ts).
import type { DadosCnpj } from "@contabilizadev/nucleo/brasilapi/cnpj";
import { REGRAS_CNAE } from "@contabilizadev/nucleo/cnae";
import { NATUREZAS_ATENDIDAS, opcaoVigente, type Diagnostico } from "@contabilizadev/nucleo/diagnostico";
import { brl, dataBr } from "@contabilizadev/nucleo/formato";
import { LIMITE_FATOR_R } from "@contabilizadev/nucleo/simples";
// Só tipos: a tela do navegador usa este módulo e não pode levar junto o código do servidor nem o do termo.
import type { ParametrosTermo, PreparoAutorizacao } from "@/lib/termo/termo";
import type { Previa } from "./cadastro";
import { normalizarCnpj } from "./cnpj";
import { porcentagem } from "./glossario";

// 1-5: conferir e cadastrar (o cadastro acontece no 5, Diagnóstico); 6: a confirmação do cadastro; 7: a autorização
// (opcional: "Fazer depois" leva ao painel e a empresa fica no modo guiado). Empresa que ainda não atendemos não é
// cadastrada: o assistente termina no 6, que diz o que fazer (etapasDo).
export const ETAPAS = [
  { id: "cnpj", nome: "Pesquisar o CNPJ" },
  { id: "empresa", nome: "Conferir a empresa" },
  { id: "atividades", nome: "Atividades" },
  { id: "simples", nome: "Simples Nacional" },
  { id: "diagnostico", nome: "Diagnóstico" },
  { id: "proximos", nome: "Empresa cadastrada" },
  { id: "autorizacao", nome: "Autorização" },
] as const;

export type IdEtapa = (typeof ETAPAS)[number]["id"];
export type Etapa = { id: IdEtapa; nome: string };

// A prévia que o assistente precisa (a do cadastro, assinada pelo servidor).
export type PreviaDoAssistente = Pick<Previa, "dados" | "diagnostico" | "consultadaEm" | "token">;

// Passo 7, preparado pelo servidor logo depois do cadastro: a empresa da própria plataforma já está autorizada (sem
// termo); as outras assinam com os parâmetros do termo; se a assinatura não está disponível (configuração da
// instalação, por exemplo), a mensagem própria diz por quê e a empresa segue no modo guiado.
export type Autorizacao = { tipo: "propria" } | { tipo: "assinar"; parametros: ParametrosTermo } | { tipo: "indisponivel"; mensagem: string };

export function autorizacaoDoPreparo(p: PreparoAutorizacao): Autorizacao {
  if (p.situacao.estado === "propria") return { tipo: "propria" };
  if (p.parametros) return { tipo: "assinar", parametros: p.parametros };
  return { tipo: "indisponivel", mensagem: p.bloqueio ?? "A assinatura da autorização ainda não está disponível. Enquanto isso, use o modo guiado." };
}

// Prazo da prévia assinada: depois disso o servidor recusa o cadastro e é preciso pesquisar de novo. Fica aqui (e não
// em cadastro.ts, que é só do servidor) porque a tela também precisa dele.
export const VALIDADE_DA_PREVIA_MS = 30 * 60 * 1000;
// A tela trata a prévia como vencida um pouco antes do servidor, para o clique não chegar lá já fora do prazo.
export const FOLGA_DA_PREVIA_MS = 60 * 1000;

// A prévia passou do prazo? A idade é medida só pelo relógio do navegador (recebidaEm é o "agora" do navegador quando a
// prévia chegou), nunca comparando com consultadaEm, que é o relógio do servidor: com o relógio do computador adiantado
// ou atrasado (dual boot com hora local, por exemplo), toda prévia nasceria vencida e o cadastro nunca aconteceria. Se
// mesmo assim os relógios divergirem durante a espera, o servidor recusa com expirou e a tela pesquisa de novo.
// Sem a hora de chegada (ou com valor que não é número), conta como vencida.
export function previaVencida(recebidaEm: number | null, agora = Date.now()): boolean {
  if (recebidaEm === null) return true;
  const idade = agora - recebidaEm;
  return !(idade <= VALIDADE_DA_PREVIA_MS - FOLGA_DA_PREVIA_MS);
}

export type EstadoAssistente = {
  etapa: IdEtapa;
  cnpj: string; // como o cliente digitou (com máscara); fica guardado ao voltar
  previa: PreviaDoAssistente | null;
  recebidaEm: number | null; // horário do navegador (ms) em que a prévia chegou; mede a idade dela (previaVencida)
  empresaId: string | null; // preenchido depois do cadastro; daí em diante os passos 1 a 5 ficam só para leitura
  autorizacao: Autorizacao | null; // o passo 7, preparado depois do cadastro (null = ainda não chegou)
  autorizadaAte: string | null; // AAAA-MM-DD: o termo foi assinado no passo 7 e vale até esta data
};

export type EventoAssistente =
  | { tipo: "digitar"; cnpj: string }
  | { tipo: "consultou"; previa: PreviaDoAssistente; agora: number } // agora: relógio do navegador quando a resposta chegou
  | { tipo: "continuar"; agora?: number }
  | { tipo: "voltar" }
  | { tipo: "cadastrou"; empresaId: string }
  | { tipo: "preparou"; autorizacao: Autorizacao }
  | { tipo: "autorizou"; validaAte: string }
  | { tipo: "recomecar" };

export const ESTADO_INICIAL: EstadoAssistente = { etapa: "cnpj", cnpj: "", previa: null, recebidaEm: null, empresaId: null, autorizacao: null, autorizadaAte: null };

export const indiceDaEtapa = (etapa: IdEtapa) => ETAPAS.findIndex((e) => e.id === etapa);

// As etapas do caminho atual. Empresa que ainda não atendemos não é cadastrada: a partir do diagnóstico (onde isso
// aparece), o caminho tem 6 etapas e a última é "O que fazer", sem a autorização.
const O_QUE_FAZER: Etapa = { id: "proximos", nome: "O que fazer" };
export function etapasDo(estado: Pick<EstadoAssistente, "etapa" | "previa">): readonly Etapa[] {
  const i = indiceDaEtapa(estado.etapa);
  // (O passo 7 nunca é alcançado sem cadastro; se for, a trilha mostra as sete etapas em vez de quebrar.)
  const naoAtendida = !!estado.previa && !estado.previa.diagnostico.atendido && i >= indiceDaEtapa("diagnostico") && i <= indiceDaEtapa("proximos");
  return naoAtendida ? [...ETAPAS.slice(0, indiceDaEtapa("proximos")), O_QUE_FAZER] : ETAPAS;
}

export const progresso = (estado: Pick<EstadoAssistente, "etapa" | "previa">) => `Passo ${indiceDaEtapa(estado.etapa) + 1} de ${etapasDo(estado).length}`;

// A prévia vale para o CNPJ que está no campo? (O cliente pode voltar ao início e digitar outro.) Vencida não vale:
// o servidor recusaria o cadastro, então o passo 1 volta a pesquisar.
export function previaDoCnpjDigitado(estado: EstadoAssistente, agora = Date.now()): boolean {
  return !!estado.previa && normalizarCnpj(estado.cnpj) === estado.previa.dados.cnpj && !previaVencida(estado.recebidaEm, agora);
}

export type AcaoPrincipal = "consultar" | "continuar" | "cadastrar" | null;

// O que o botão principal da etapa faz. No passo 1, a prévia vencida não vale: o botão volta a pesquisar. No diagnóstico
// o botão continua "cadastrar"; com a prévia vencida, a tela pesquisa de novo ali mesmo ao clicar (precisaRepesquisar)
// e pede a confirmação com os dados novos, sem mandar o cliente de volta ao início. Depois do cadastro, os passos 1 a 5
// só seguem adiante (nada é pesquisado nem cadastrado de novo). O passo 7 tem as ações próprias (assinar, Fazer depois).
export function acaoPrincipal(estado: EstadoAssistente, agora = Date.now()): AcaoPrincipal {
  switch (estado.etapa) {
    case "cnpj":
      return estado.empresaId ? "continuar" : previaDoCnpjDigitado(estado, agora) ? "continuar" : "consultar";
    case "diagnostico":
      return estado.previa?.diagnostico.atendido && !estado.empresaId ? "cadastrar" : "continuar";
    case "proximos":
      return estado.empresaId ? "continuar" : null;
    case "autorizacao":
      return null;
    default:
      return "continuar";
  }
}

// No diagnóstico, cadastrar com a prévia vencida seria recusado pelo servidor: antes, pesquisa o CNPJ de novo.
export const precisaRepesquisar = (estado: EstadoAssistente, agora = Date.now()) =>
  acaoPrincipal(estado, agora) === "cadastrar" && !!estado.previa && previaVencida(estado.recebidaEm, agora);

// "Continuar" leva à próxima etapa? Na primeira, só com a consulta do CNPJ digitado (ou com a empresa já cadastrada);
// no diagnóstico, empresa atendida só segue depois de cadastrada (a não atendida segue para o que fazer, sem cadastro);
// do 6 para o 7, só com a empresa cadastrada. O 7 é o último.
export function podeAvancar(estado: EstadoAssistente, agora = Date.now()): boolean {
  if (!estado.previa) return false;
  switch (estado.etapa) {
    case "cnpj":
      return !!estado.empresaId || previaDoCnpjDigitado(estado, agora);
    case "diagnostico":
      return !estado.previa.diagnostico.atendido || !!estado.empresaId;
    case "proximos":
      return !!estado.empresaId;
    case "autorizacao":
      return false;
    default:
      return true;
  }
}

// Dá para voltar de qualquer etapa menos a primeira. Depois do cadastro, voltar só mostra o que foi conferido: o CNPJ
// não muda, nada é pesquisado nem cadastrado de novo (o redutor ignora digitar, consultou e cadastrou).
export const podeVoltar = (estado: EstadoAssistente) => indiceDaEtapa(estado.etapa) > 0;

// O passo 7, conforme o que o servidor preparou e o que já aconteceu nele.
export type VistaDaAutorizacao = "carregando" | "propria" | "assinar" | "indisponivel" | "concluida";
export function vistaDaAutorizacao(estado: Pick<EstadoAssistente, "autorizacao" | "autorizadaAte">): VistaDaAutorizacao {
  if (estado.autorizadaAte) return "concluida";
  return estado.autorizacao?.tipo ?? "carregando";
}

// Título da etapa (o foco vai para ele a cada troca de etapa).
export function tituloDaEtapa(estado: EstadoAssistente): string {
  switch (estado.etapa) {
    case "cnpj":
      return "Qual é o CNPJ da empresa?";
    case "empresa":
      return "Confira os dados da empresa";
    case "atividades":
      return "O que a empresa faz (atividades)";
    case "simples":
      return "A empresa está no Simples Nacional?";
    case "diagnostico":
      return estado.previa && !estado.previa.diagnostico.atendido ? "Ainda não atendemos esta empresa" : "Em que anexo a empresa fica";
    case "proximos":
      return estado.empresaId ? "Empresa cadastrada" : "Por que não cadastramos e o que fazer";
    case "autorizacao":
      switch (vistaDaAutorizacao(estado)) {
        case "concluida":
          return "Tudo pronto";
        case "propria":
          return "A empresa já está autorizada";
        default:
          return "Autorize a plataforma na Receita Federal";
      }
  }
}

// Dia da consulta no Brasil (AAAA-MM-DD): é com ele que o diagnóstico foi feito, então os textos usam o mesmo dia.
export const diaDaConsulta = (consultadaEm: string) => new Date(consultadaEm).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

export function reduzir(estado: EstadoAssistente, evento: EventoAssistente): EstadoAssistente {
  const i = indiceDaEtapa(estado.etapa);
  switch (evento.tipo) {
    case "digitar":
      return estado.etapa === "cnpj" && !estado.empresaId ? { ...estado, cnpj: evento.cnpj } : estado;
    case "consultou":
      if (estado.empresaId) return estado;
      if (estado.etapa === "cnpj") return { ...estado, previa: evento.previa, recebidaEm: evento.agora, etapa: "empresa" };
      // Pesquisa refeita no diagnóstico (a prévia tinha vencido): troca a prévia e fica na etapa, para o cliente conferir
      // o diagnóstico com os dados novos. Só vale para o mesmo CNPJ (resposta atrasada de outro é ignorada).
      if (estado.etapa === "diagnostico" && estado.previa?.dados.cnpj === evento.previa.dados.cnpj) return { ...estado, previa: evento.previa, recebidaEm: evento.agora };
      return estado;
    case "continuar":
      return podeAvancar(estado, evento.agora) ? { ...estado, etapa: ETAPAS[i + 1].id } : estado;
    case "voltar":
      return podeVoltar(estado) ? { ...estado, etapa: ETAPAS[i - 1].id } : estado;
    case "cadastrou":
      if (estado.etapa !== "diagnostico" || !estado.previa?.diagnostico.atendido || estado.empresaId) return estado;
      return { ...estado, empresaId: evento.empresaId, etapa: "proximos" };
    case "preparou":
      // Só depois do cadastro; uma vez assinado, o passo 7 não volta a pedir a assinatura.
      return estado.empresaId && !estado.autorizadaAte ? { ...estado, autorizacao: evento.autorizacao } : estado;
    case "autorizou":
      // Vale em qualquer etapa depois do cadastro: o envio pode terminar com o cliente já de volta a um passo anterior,
      // e o termo já foi registrado no servidor; perder a confirmação faria o passo 7 pedir a assinatura de novo.
      if (!estado.empresaId || estado.autorizacao?.tipo !== "assinar" || estado.autorizadaAte) return estado;
      return { ...estado, autorizadaAte: evento.validaAte };
    case "recomecar":
      return ESTADO_INICIAL;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Textos das etapas (dependem dos dados da Receita).

// curto: a frase que fica na tela. Com problema (ok: false), o curto diz o motivo e o que fazer, numa frase; o tooltip
// tem a pergunta do caso (titulo, que também é o rótulo anunciado) e o texto que responde a ela: por que impede e,
// depois de "O que fazer:", o passo a passo. Em ordem, só o curto. neutro: dado que a Receita não informa e que não
// impede o cadastro.
export type Explicacao = { ok: true; curto: string; neutro?: boolean } | { ok: false; curto: string; titulo: string; texto: string };

// Situação cadastral: só ATIVA serve; para as outras, por que impede e o que fazer.
export function explicarSituacao(situacao: string): Explicacao {
  switch (situacao) {
    case "ATIVA":
      return { ok: true, curto: "CNPJ ativo." };
    case "INAPTA":
      return {
        ok: false,
        curto: "CNPJ inapto: regularize as pendências no e-CAC e volte aqui.",
        titulo: "Por que o CNPJ inapto impede o cadastro?",
        texto:
          "Com o CNPJ inapto, a empresa não pode emitir notas nem declarar normalmente; inapta costuma ser por declarações não entregues. O que fazer: no e-CAC, veja o que está pendente, entregue e peça a regularização. Depois, volte aqui.",
      };
    case "SUSPENSA":
      return {
        ok: false,
        curto: "CNPJ suspenso: resolva a pendência com a Receita Federal e volte aqui.",
        titulo: "Por que o CNPJ suspenso impede o cadastro?",
        texto: "Suspensa quer dizer que há uma pendência no cadastro, e a empresa não pode funcionar normalmente até resolver. O que fazer: veja o motivo no e-CAC, resolva com a Receita Federal e volte aqui.",
      };
    case "BAIXADA":
      return {
        ok: false,
        curto: "CNPJ baixado (empresa encerrada): não dá para cadastrar.",
        titulo: "Por que um CNPJ baixado não pode ser cadastrado?",
        texto: "Baixada quer dizer que a empresa foi encerrada, e esse CNPJ não volta a valer. O que fazer: para ter empresa de novo, é preciso abrir outra e cadastrar o CNPJ novo.",
      };
    case "NULA":
      return {
        ok: false,
        curto: "CNPJ nulo: não pode ser usado.",
        titulo: "Por que um CNPJ nulo não pode ser cadastrado?",
        texto: "Nula quer dizer que o cadastro foi anulado pela Receita Federal, e esse CNPJ não pode ser usado. O que fazer: confira no Cartão CNPJ se o número digitado é o da empresa; se for, procure a Receita Federal.",
      };
    default:
      return {
        ok: false,
        curto: `Situação ${situacao}: precisamos de CNPJ ativo.`,
        titulo: "Por que a situação do CNPJ impede o cadastro?",
        texto: `A situação é ${situacao}, e só atendemos CNPJ ativo. O que fazer: veja o motivo no e-CAC, regularize e volte aqui.`,
      };
  }
}

export function explicarNatureza(codigo: string): Explicacao {
  return NATUREZAS_ATENDIDAS[codigo]
    ? { ok: true, curto: "Tipo de empresa atendido." }
    : {
        ok: false,
        curto: "Tipo de empresa ainda não atendido.",
        titulo: "Por que o tipo de empresa impede o cadastro?",
        texto:
          "Nesta versão, atendemos sociedade limitada (inclusive a unipessoal, antiga EIRELI), empresário individual e sociedade simples: os tipos que uma empresa de TI do Simples costuma ter. O que fazer: se a empresa mudou de tipo, a mudança é registrada na Junta Comercial (ou no cartório) e a Receita Federal atualiza depois; aí é só pesquisar de novo.",
      };
}

export type ResumoSimples = { simples: Explicacao; mei: Explicacao };

// Simples Nacional e MEI hoje, em linguagem simples.
export function resumoSimples(dados: Pick<DadosCnpj, "simples" | "mei">, hoje: string): ResumoSimples {
  const s = dados.simples;
  const noSimples = opcaoVigente(s, hoje);
  let simples: Explicacao;
  if (noSimples === null) {
    simples = {
      ok: false,
      curto: "A Receita Federal não informa se a empresa é optante.",
      titulo: "Por que precisamos saber se a empresa é do Simples?",
      texto:
        "Atendemos só empresas do Simples Nacional, e sem essa informação não dá para saber em que regime a empresa está. O que fazer: confira no Portal do Simples Nacional, em \"Consulta Optantes\", com o CNPJ. Se a empresa for optante, pesquise de novo mais tarde.",
    };
  } else if (noSimples) {
    // Saída do Simples marcada para depois: não impede o cadastro; o aviso aparece no diagnóstico (observação).
    simples = { ok: true, curto: `Optante do Simples Nacional${s.dataOpcao ? ` desde ${dataBr(s.dataOpcao)}` : ""}.` };
  } else {
    const saida = s.dataExclusao && s.dataExclusao <= hoje ? dataBr(s.dataExclusao) : null;
    const saiu = saida ? ` Ela saiu do Simples em ${saida}.` : "";
    simples = {
      ok: false,
      curto: `Fora do Simples Nacional${saida ? ` desde ${saida}` : ""}: ainda não atendemos.`,
      titulo: "Por que estar fora do Simples impede o cadastro?",
      // Empresa já aberta só pede a opção em janeiro (LC 123/2006, art. 16, § 2º).
      texto: `A empresa não está no Simples Nacional.${saiu} Então ela está no Lucro Presumido ou no Lucro Real, regimes que esta plataforma não calcula. O que fazer: se a empresa quiser voltar ao Simples, a opção é pedida em janeiro, no Portal do Simples Nacional; depois que a Receita Federal confirmar, é só pesquisar de novo.`,
    };
  }

  const m = dados.mei;
  const ehMei = opcaoVigente(m, hoje);
  const desde = m.dataOpcao ? ` desde ${dataBr(m.dataOpcao)}` : "";
  let mei: Explicacao;
  if (ehMei === null) {
    // Sem a informação, o diagnóstico segue como não MEI; a tela diz que a Receita não informou, sem ✓ nem alerta.
    mei = { ok: true, neutro: true, curto: "A Receita Federal não informa se a empresa é MEI." };
  } else if (ehMei) {
    mei = {
      ok: false,
      curto: `É MEI${desde}: ainda não atendemos MEI.`,
      titulo: "Por que ser MEI impede o cadastro?",
      texto: `O MEI paga um valor fixo por mês (o DAS-MEI), e não o Simples por anexo, que é o que esta plataforma calcula. O que fazer: enquanto for MEI, o DAS-MEI sai no Portal do Empreendedor. Se a empresa deixar de ser MEI e ficar no Simples Nacional, é só pesquisar de novo.`,
    };
  } else {
    mei = { ok: true, curto: "Não é MEI." };
  }
  return { simples, mei };
}

// Exemplo do Fator R com números redondos: receita de R$ 10 mil por mês.
export function exemploFatorR(receitaMensal = 10_000) {
  const receita12 = receitaMensal * 12;
  const minimo12 = Math.round(receita12 * LIMITE_FATOR_R * 100) / 100;
  const minimoMensal = Math.round(receitaMensal * LIMITE_FATOR_R * 100) / 100;
  const abaixoMensal = Math.round(receitaMensal * 0.15 * 100) / 100;
  return {
    receitaMensal,
    receita12,
    minimo12,
    minimoMensal,
    abaixoMensal,
    textos: [
      `Receita de ${brl(receitaMensal)} por mês dá ${brl(receita12)} em 12 meses.`,
      `${porcentagem(LIMITE_FATOR_R)} de ${brl(receita12)} é ${brl(minimo12)}: a folha dos 12 meses precisa chegar a isso. Sem funcionários, a folha é só o pró-labore.`,
      `Pró-labore de ${brl(minimoMensal)} por mês: Fator R de ${porcentagem(LIMITE_FATOR_R)}, a receita fica no Anexo III.`,
      `Pró-labore de ${brl(abaixoMensal)} por mês: Fator R de ${porcentagem(0.15)}, a receita vai para o Anexo V, bem mais caro.`,
    ],
  };
}

// Grupos de CNAE atendidos, da tabela de regras do núcleo: "6201, 6202, …, 6311 e 6319".
export const GRUPOS_ATENDIDOS = [...new Set(REGRAS_CNAE.map((r) => r.cnae.slice(0, 4)))];
const listaDeGrupos = `${GRUPOS_ATENDIDOS.slice(0, -1).join(", ")} e ${GRUPOS_ATENDIDOS.at(-1)}`;

// titulo e curto ficam na tela (o que fazer, numa frase); texto, com os detalhes, vai para o tooltip, e pergunta é o
// rótulo do tooltip (o que o leitor de tela anuncia).
export type Orientacao = { titulo: string; curto: string; texto: string; pergunta: string };

// CNPJ que não está ativo: o título e a frase dizem o que fazer (baixado e nulo não se regularizam).
function orientacaoDaSituacao(situacao: string): Orientacao {
  const e = explicarSituacao(situacao);
  const texto = e.ok ? e.curto : e.texto; // só chamada com CNPJ não ativo (ok: false)
  switch (situacao) {
    case "BAIXADA":
      return { titulo: "CNPJ encerrado", pergunta: "Dá para cadastrar um CNPJ encerrado?", curto: "Para cadastrar, é preciso abrir uma nova empresa.", texto };
    case "NULA":
      return { titulo: "CNPJ anulado", pergunta: "O que quer dizer CNPJ anulado?", curto: "Confira se o número está certo: este CNPJ não pode ser usado.", texto };
    case "INAPTA":
      return { titulo: "Regularizar o CNPJ", pergunta: "Como regularizar o CNPJ inapto?", curto: "Entregue as declarações pendentes no e-CAC e peça a regularização.", texto };
    case "SUSPENSA":
      return { titulo: "Regularizar o CNPJ", pergunta: "Como regularizar o CNPJ suspenso?", curto: "Veja o motivo no e-CAC e resolva a pendência com a Receita Federal.", texto };
    default:
      return { titulo: "Regularizar o CNPJ", pergunta: "Como deixar o CNPJ ativo?", curto: "Veja o motivo no e-CAC e deixe o CNPJ ativo.", texto };
  }
}

// Quando ainda não atendemos: o que a pessoa pode fazer, um item por motivo do diagnóstico.
export function orientacoes(dados: DadosCnpj, diagnostico: Diagnostico, hoje: string): Orientacao[] {
  if (diagnostico.atendido) return [];
  const lista: Orientacao[] = [];
  if (dados.situacaoCadastral !== "ATIVA") lista.push(orientacaoDaSituacao(dados.situacaoCadastral));
  // CNPJ baixado ou anulado não volta a valer: nada de regularizar este mesmo CNPJ (Simples, MEI, tipo, atividades),
  // o que contradiria "abra uma nova empresa".
  if (dados.situacaoCadastral === "BAIXADA" || dados.situacaoCadastral === "NULA") return lista;
  const ehMei = opcaoVigente(dados.mei, hoje);
  if (ehMei) {
    lista.push({
      titulo: "Sair do MEI, se for o caso",
      pergunta: "Como sair do MEI?",
      curto: "Peça o desenquadramento do MEI no Portal do Simples Nacional (fale com um contador antes).",
      texto:
        "Se a empresa fatura mais que o limite do MEI ou tem atividade que o MEI não permite, ela precisa sair do MEI (desenquadramento, no Portal do Simples Nacional) e passa para o Simples Nacional comum. Aí podemos atender. Converse com um contador antes, porque o imposto muda.",
    });
  }
  const noSimples = opcaoVigente(dados.simples, hoje);
  if (noSimples === null) {
    lista.push({
      titulo: "Conferir a opção pelo Simples",
      pergunta: "Como conferir se a empresa é do Simples?",
      curto: "Confira no Portal do Simples Nacional e tente de novo mais tarde.",
      texto: "A Receita Federal não informou se a empresa é do Simples. Confira no Portal do Simples Nacional (consulta optantes) e tente de novo mais tarde.",
    });
  } else if (!noSimples && !ehMei) {
    lista.push({
      titulo: "Entrar no Simples Nacional",
      pergunta: "Como entrar no Simples Nacional?",
      curto: "Faça a opção no Portal do Simples Nacional e cadastre de novo.",
      texto:
        "A opção pelo Simples é feita no Portal do Simples Nacional, em janeiro (vale para o ano todo), ou logo depois de abrir a empresa. Quando a empresa estiver no Simples, é só cadastrar de novo aqui.",
    });
  }
  if (!NATUREZAS_ATENDIDAS[dados.naturezaJuridica.codigo]) {
    lista.push({
      titulo: "Tipo de empresa",
      pergunta: "Que tipos de empresa atendemos?",
      curto: "Para este tipo de empresa, procure um contador.",
      texto: "Atendemos sociedade limitada (inclusive a unipessoal, antiga EIRELI), empresário individual e sociedade simples. Para outros tipos, procure um contador.",
    });
  }
  if (diagnostico.atividades.some((a) => a.tributacao === "nao-atendido")) {
    lista.push({
      titulo: "Atividades fora de TI",
      pergunta: "Como tirar as atividades fora de TI?",
      curto: "Atendemos só TI: tire as outras atividades do contrato social e cadastre de novo.",
      texto:
        `Nesta versão atendemos só empresas de TI (CNAEs ${listaDeGrupos}). Se a empresa não exerce mais as outras atividades, dá para tirá-las com uma alteração no contrato social (na Junta Comercial ou no cartório); a Receita atualiza o CNPJ em seguida e aí você cadastra de novo.`,
    });
  }
  return lista;
}
