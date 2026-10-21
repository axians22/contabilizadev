// Só para testes: respostas gravadas da Caixa Postal no formato dos exemplos oficiais do Integra Contador ("Retorno Obter
// Lista de Mensagens por Contribuintes" e "Retorno Obter Detalhes de uma Mensagem Específica"), com dados fictícios.
import type { Resposta } from "./cliente.ts";

export type MensagemDeExemplo = {
  isn: string;
  assunto: string; // com ++VARIAVEL++ quando houver parâmetro
  parametro?: string;
  envio: string; // AAAAMMDDhhmmss
  lida?: boolean;
  ciencia?: string; // AAAAMMDD
  relevante?: boolean;
  origem?: string;
};

// Uma página da lista (até 50 mensagens). `proxima`: o ponteiro da próxima página (sem ele, é a última).
export function respostaListaCaixa(mensagens: MensagemDeExemplo[], proxima?: string): Resposta {
  return {
    status: 200,
    mensagens: [{ codigo: "[Sucesso-CAIXAPOSTAL]", texto: "Requisição efetuada com sucesso." }],
    dados: {
      codigo: "00",
      conteudo: [
        {
          quantidadeMensagens: String(mensagens.length),
          indicadorUltimaPagina: proxima ? "N" : "S",
          ponteiroPaginaRetornada: "000000000000000000000000",
          ponteiroProximaPagina: proxima ?? "",
          listaMensagens: mensagens.map((m) => ({
            codigoSistemaRemetente: "00019",
            codigoModelo: "00007",
            dataEnvio: m.envio.slice(0, 8),
            horaEnvio: m.envio.slice(8, 14),
            numeroControle: `${m.envio.slice(0, 4)}/${m.isn.padStart(15, "0")}`,
            indicadorLeitura: m.lida ? "1" : "0",
            dataLeitura: m.lida ? m.envio.slice(0, 8) : "",
            horaLeitura: "",
            dataExclusao: "",
            horaExclusao: "",
            dataCiencia: m.ciencia ?? "",
            assuntoModelo: m.assunto,
            dataValidade: "20301231",
            origemModelo: "1",
            valorParametroAssunto: m.parametro ?? "",
            relevancia: m.relevante ? "2" : "1",
            isn: m.isn,
            tipoOrigem: "1",
            descricaoOrigem: m.origem ?? "RECEITA FEDERAL DO BRASIL",
            indicadorFavorito: "0",
          })),
        },
      ],
    },
  };
}

// O conteúdo de uma mensagem (o serviço que registra a ciência na Receita).
export function respostaConteudoCaixa(corpo: string, variaveis: string[] = []): Resposta {
  return {
    status: 200,
    mensagens: [{ codigo: "[Sucesso-CAIXAPOSTAL]", texto: "Requisição efetuada com sucesso." }],
    dados: { codigo: "00", conteudo: [{ codigoSistemaRemetente: "00019", corpoModelo: corpo, variaveis }] },
  };
}

export const INTIMACAO: MensagemDeExemplo = {
  isn: "0001626772",
  assunto: "Termo de Intimação - Processo ++VARIAVEL++",
  parametro: "10000.000001/2026-11",
  envio: "20261015092949",
  relevante: true,
};
export const AVISO_LIDO: MensagemDeExemplo = { isn: "0001626770", assunto: "Declaração processada", envio: "20261001080102", lida: true, ciencia: "20261001" };
export const CORPO_INTIMACAO = "<p>Prezado(a) Contribuinte,</p><p>Fica intimado a apresentar os documentos do processo ++1++ em ++2++ dias.</p><p><a href=\"/ecac/processos\">Abrir no e-CAC</a></p>";
