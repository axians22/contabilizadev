// A central de avisos da empresa ativa (sino e página Avisos): junta todas as fontes, só banco (nada é consultado na
// Receita para montar um aviso). Cada fonte roda separada: se uma falhar, as outras continuam (a falha vai para o log).
// O aviso do certificado guardado no navegador entra lá, no navegador (central.ts, avisoDoCertificadoGuardado).
import { somarMeses } from "@contabilizadev/nucleo/meses";
import type { Banco } from "@/banco";
import { resumoDaCaixa } from "@/lib/caixa-postal/caixa-postal";
import { entregaDaDeclaracaoAnual, inicioNoSimples } from "@/lib/defis/prazo";
import type { AcessoEmpresa } from "@/lib/empresas/acesso";
import { ultimaConsulta } from "@/lib/empresas/receita";
import { situacaoEsocial } from "@/lib/esocial/envio";
import { avisosDoHistorico, defisDoAno, historicoDaEmpresa, situacaoFiscalDaEmpresa } from "@/lib/historico/leitura";
import { hojeNoBrasil, mesAtualNoBrasil } from "@/lib/historico/prazos";
import { situacaoDctf } from "@/lib/rotina/dctfweb";
import { avisoFatorR } from "@/lib/rotina/fator-r";
import { guiasVencidas } from "@/lib/rotina/guias";
import { avisoDaSituacao, liberada, type Situacao } from "@/lib/termo/situacao";
import { juntarAvisos, type AvisoDoSino } from "./central";
import { avisoDaDctfweb, avisoDaDefis, avisoDasMensagens, avisoDoEsocial, avisoDoFatorR, avisoDoTermo, avisosDasGuias, avisosDoPgdasd } from "./fontes";

type Opcoes = { termo: Situacao; log?: (mensagem: string) => void };

export async function avisosDaEmpresa(banco: Banco, acesso: AcessoEmpresa, agora: Date, opcoes: Opcoes): Promise<AvisoDoSino[]> {
  const log = opcoes.log ?? console.error;
  const seguro = async (nome: string, fonte: () => Promise<AvisoDoSino[]>): Promise<AvisoDoSino[]> => {
    try {
      return await fonte();
    } catch (erro) {
      log(`Aviso "${nome}" da empresa ${acesso.empresaId} não montado: ${(erro as Error).message}`);
      return [];
    }
  };
  const hoje = hojeNoBrasil(agora);
  const ultimoMes = somarMeses(mesAtualNoBrasil(agora), -1);

  // A consulta do CNPJ serve ao histórico, à declaração anual e ao Fator R: lida uma vez só. Promessa compartilhada, aguardada dentro
  // de cada fonte, para que uma falha nela continue isolada pelo seguro() (o catch abaixo evita rejeição sem dono).
  const consultaDoCnpj = ultimaConsulta(banco, acesso);
  consultaDoCnpj.catch(() => {});

  const listas = await Promise.all([
    seguro("autorização", async () => avisoDoTermo(avisoDaSituacao(opcoes.termo), opcoes.termo)),
    seguro("histórico", async () => {
      const consulta = await consultaDoCnpj;
      const meses = await historicoDaEmpresa(banco, acesso, agora, consulta?.diagnostico ?? null);
      const inicio = consulta?.dados.dataInicioAtividade?.slice(0, 7) || undefined;
      return [...avisosDoHistorico(meses, await situacaoFiscalDaEmpresa(banco, acesso)), ...avisosDoPgdasd(meses, hoje, ultimoMes, inicio)];
    }),
    seguro("guias vencidas", async () => avisosDasGuias(await guiasVencidas(banco, acesso, agora))),
    seguro("eSocial e DCTFWeb", async () => {
      const s = await situacaoEsocial(banco, acesso, ultimoMes, agora);
      const usaEsocialAqui = Boolean(s.proLabore && s.proLabore > 0 && (s.config || s.envio));
      const esocial = usaEsocialAqui ? avisoDoEsocial({ mes: ultimoMes, hoje, feito: s.concluido }) : [];
      // O fechamento do eSocial aceito transmite a DCTFWeb do mês (Parte 7): conta como feita.
      const dctf = await situacaoDctf(banco, acesso, ultimoMes, agora);
      return [...esocial, ...avisoDaDctfweb({ mes: ultimoMes, hoje, proLabore: s.proLabore, feito: dctf.transmitida || s.concluido, conferivel: liberada(opcoes.termo) })];
    }),
    seguro("declaração anual", async () => {
      const ano = Number(hoje.slice(0, 4)) - 1;
      const [doAno, consulta] = await Promise.all([defisDoAno(banco, acesso, ano), consultaDoCnpj]);
      // Empresa que entrou no Simples depois do ano declarado não deve a declaração dele.
      return avisoDaDefis(hoje, entregaDaDeclaracaoAnual(ano, doAno), inicioNoSimples(consulta?.dados));
    }),
    seguro("Fator R", async () => avisoDoFatorR(await avisoFatorR(banco, acesso, agora, consultaDoCnpj))),
    seguro("mensagens", async () => avisoDasMensagens(await resumoDaCaixa(banco, acesso))),
  ]);
  return juntarAvisos(...listas);
}
