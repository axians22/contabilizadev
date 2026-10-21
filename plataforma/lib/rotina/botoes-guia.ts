// Os botões da guia do mês (como no ../fiscal, app/botoes-guias.tsx): um para abrir o PDF em nova aba ("Ver guia" quando
// paga, "Abrir guia" em aberto, "Guia original" vencida) e "Baixar". Puro: o painel, a aba Guias e o Histórico desenham
// o mesmo resultado pelo mesmo componente (app/(painel)/botoes-da-guia.tsx).
// - PDF guardado: a rota protegida de documentos (/documentos/guia/<id>);
// - sem o PDF (mês feito fora da plataforma), com a autorização em dia: a rota que busca na Receita uma única vez e
//   guarda (/documentos/guia-do-mes/<tipo>/<mês>; lib/rotina/guias.ts, buscarGuiaDoMes);
// - sem serviço para o caso (sem autorização, pago sem o documento do pagamento, vencida sem a original guardada): o
//   caminho no portal, com os passos no tooltip.
import { CAMINHOS, type CaminhoManual } from "@/lib/termo/guiado";
import { enderecoDoDocumento } from "@/lib/historico/documentos";
import type { GuiaDoMes, TipoGuia } from "./guias";

export type SituacaoDaGuia = "pago" | "aberto" | "vencido";

export type EntradaDosBotoes = {
  pa: string;
  tipo: TipoGuia;
  situacao: SituacaoDaGuia;
  guardada: string | null; // id da guia (ou do comprovante) com o PDF no banco
  referencia: string | null; // a declaração (DAS) ou a DCTFWeb transmitida (DARF): sem ela não há guia a emitir
  pagamento: string | null; // pago: o número do documento pago
  semValor?: boolean; // DAS declarado com valor zero: não há guia
  autorizada: boolean;
};

export type ExplicacaoDosBotoes = { texto: string[]; passos?: string[] };
export type Botoes =
  | { modo: "guardada" | "buscar"; rotulo: string; abrir: string; baixar: string; explicacao: ExplicacaoDosBotoes | null }
  | { modo: "portal"; rotulo: string; portal: CaminhoManual["portal"]; explicacao: ExplicacaoDosBotoes };

export const ROTULO_DA_GUIA: Record<SituacaoDaGuia, string> = { pago: "Ver guia", aberto: "Abrir guia", vencido: "Guia original" };

export const enderecoDaBusca = (tipo: TipoGuia, pa: string) => `/documentos/guia-do-mes/${tipo}/${pa}`;

const EXPLICA_BUSCA_PAGA: ExplicacaoDosBotoes = {
  texto: ["Esta guia foi paga fora da plataforma. Ao abrir, a plataforma busca na Receita Federal o comprovante de arrecadação do pagamento, uma vez só, e guarda aqui."],
};
const EXPLICA_BUSCA_ABERTA: ExplicacaoDosBotoes = {
  texto: ["Esta guia ainda não foi gerada aqui. Ao abrir, a plataforma busca a guia do mês na Receita Federal, uma vez só, e guarda aqui."],
};

const passosDoPortal = (caminho: CaminhoManual, motivo: string): ExplicacaoDosBotoes => ({ texto: [motivo], passos: caminho.passos });

export function botoesDaGuia(e: EntradaDosBotoes): Botoes | null {
  const rotulo = ROTULO_DA_GUIA[e.situacao];
  if (e.guardada) {
    const endereco = enderecoDoDocumento("guia", e.guardada);
    return { modo: "guardada", rotulo, abrir: endereco, baixar: endereco, explicacao: null };
  }
  if (e.situacao === "pago") {
    if (e.semValor) return null;
    const caminho = CAMINHOS.pagamentos;
    if (!e.pagamento) return { modo: "portal", rotulo: "Comprovante no portal", portal: caminho.portal, explicacao: passosDoPortal(caminho, "A Receita Federal ainda não mostrou aqui o documento deste pagamento. O comprovante fica no portal:") };
    if (!e.autorizada) return { modo: "portal", rotulo: "Comprovante no portal", portal: caminho.portal, explicacao: passosDoPortal(caminho, "Até a autorização da empresa, o comprovante do pagamento fica no portal:") };
    return { modo: "buscar", rotulo, abrir: enderecoDaBusca(e.tipo, e.pa), baixar: `${enderecoDaBusca(e.tipo, e.pa)}?baixar=1`, explicacao: EXPLICA_BUSCA_PAGA };
  }
  // Sem a declaração (ou a DCTFWeb) não há guia; DAS declarado com valor zero também não tem.
  if (!e.referencia || e.semValor) return null;
  // Vencida sem a original guardada: nenhum serviço devolve a guia original depois do vencimento (a emissão sai sempre
  // atualizada, com multa e juros). O botão aparece mesmo assim e leva ao portal, com o motivo no tooltip.
  if (e.situacao === "vencido") {
    const caminho = e.tipo === "DAS" ? CAMINHOS.guiaDoMes : CAMINHOS.dctfweb;
    const onde = e.tipo === "DAS" ? "no PGDAS-D do Portal do Simples Nacional" : "na DCTFWeb do e-CAC";
    return {
      modo: "portal",
      rotulo,
      portal: caminho.portal,
      explicacao: passosDoPortal(
        caminho,
        `A guia original venceu e não foi gerada aqui; a Receita Federal não devolve a original depois do vencimento. Para pagar, gere a guia com multa e juros aqui mesmo ou ${onde}:`,
      ),
    };
  }
  if (!e.autorizada) {
    const caminho = e.tipo === "DAS" ? CAMINHOS.guiaDoMes : CAMINHOS.dctfweb;
    return { modo: "portal", rotulo: "Gerar no portal", portal: caminho.portal, explicacao: passosDoPortal(caminho, "Até a autorização da empresa, a guia é gerada no portal:") };
  }
  return { modo: "buscar", rotulo, abrir: enderecoDaBusca(e.tipo, e.pa), baixar: `${enderecoDaBusca(e.tipo, e.pa)}?baixar=1`, explicacao: EXPLICA_BUSCA_ABERTA };
}

// A entrada a partir da guia do mês (painel e aba Guias). `situacao` já vem decidida pela tela (o painel olha a
// receita lançada para dizer se venceu).
export function entradaDaGuia(g: GuiaDoMes, situacao: SituacaoDaGuia, autorizada: boolean): EntradaDosBotoes {
  const guardada = situacao === "pago" ? (g.original ?? g.comprovante ?? null) : g.original;
  return {
    pa: g.pa,
    tipo: g.tipo,
    situacao,
    guardada: guardada?.id ?? null,
    referencia: g.referencia,
    pagamento: g.pagamento?.numero ?? null,
    semValor: g.tipo === "DAS" && g.declarado === 0,
    autorizada,
  };
}

// O valor do cartão: o da guia, o declarado, o pago (quando a guia é desconhecida) ou o calculado aqui, com a origem.
export function valorDaGuia(g: GuiaDoMes, calculado: number | null): { valor: number | null; origem: "" | "declarado" | "pago" | "calculado" } {
  if (g.original?.total != null) return { valor: g.original.total, origem: "" };
  if (g.declarado != null) return { valor: g.declarado, origem: "declarado" };
  // O total efetivamente pago (com multa e juros, se pago com atraso), não o principal.
  if (g.paga && g.pagamento?.valor != null) return { valor: g.pagamento.valor, origem: "pago" };
  if (calculado !== null) return { valor: calculado, origem: "calculado" };
  return { valor: null, origem: "" };
}
