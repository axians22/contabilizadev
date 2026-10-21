import { rotuloMes } from "@contabilizadev/nucleo/meses";
import { GraficoBarras } from "@/app/graficos";
import { Secao } from "@/app/ui";
import { banco } from "@/banco";
import { abaDaEmpresa } from "@/lib/abas";
import { exigirConteudo } from "@/lib/empresas/portao-servidor";
import { ultimaConsulta } from "@/lib/empresas/receita";
import { conferenciaDoHistorico } from "@/lib/historico/conferencia";
import { historicoDaEmpresa, ultimasConsultas } from "@/lib/historico/leitura";
import { anosDoHistorico, INTERVALO_MANUAL_MINUTOS } from "@/lib/historico/prazos";
import { atualizarAoAbrir } from "@/lib/historico/servidor";
import { empresaDaRotina, historicoDeValores } from "@/lib/rotina/base";
import { termoDoServidor } from "@/lib/termo/servidor";
import { liberada } from "@/lib/termo/situacao";
import { situacaoTermo } from "@/lib/termo/termo";
import { FacaNoPortal } from "../faca-no-portal";
import { PortaoFechado } from "../portao";
import { atualizarHistoricoAcao } from "./acoes";
import { Acompanhar, ConsultadoEm } from "./acompanhar";
import { BotaoAtualizarHistorico } from "./botao-atualizar";
import { TelaDoHistorico } from "./tela-historico";

export const metadata = { title: "Histórico · ContabilizaDev" };

const curto = (pa: string) => `${pa.slice(5, 7)}/${pa.slice(2, 4)}`;

// Histórico e conferência (no desenho do ../fiscal, app/historico/page.tsx; a tela fica em tela-historico.tsx): as
// declarações do PGDAS-D e os pagamentos dos últimos 12 meses, importados da Receita Federal (banco primeiro: ao abrir, só
// o que está velho é buscado, em segundo plano), o DAS calculado aqui ao lado do emitido, e a conferência do CNAE com a
// atividade declarada. Sem autorização, o modo guiado mostra o caminho no portal (e o que já foi importado continua aqui).
// ?prolabore=1 abre as colunas do pró-labore e do INSS, como no ../fiscal.
export default async function Historico({ searchParams }: { searchParams: Promise<{ prolabore?: string }> }) {
  const { portao } = await exigirConteudo();
  const aba = abaDaEmpresa("/historico");
  if (portao.estado !== "liberado") return <PortaoFechado aba={aba} portao={portao} />;
  const { empresa, acesso } = portao;
  const situacao = await situacaoTermo(await termoDoServidor(), acesso);
  const autorizada = liberada(situacao);
  if (autorizada) await atualizarAoAbrir(acesso, ["historico"]);
  const mostrarProLabore = (await searchParams).prolabore === "1";

  const agora = new Date();
  const consulta = await ultimaConsulta(banco(), acesso);
  const [meses, consultas, valores, daRotina] = await Promise.all([
    historicoDaEmpresa(banco(), acesso, agora, consulta?.diagnostico ?? null),
    ultimasConsultas(banco(), acesso),
    historicoDeValores(banco(), acesso),
    empresaDaRotina(banco(), acesso, Promise.resolve(consulta)),
  ]);
  const consultadoEm = anosDoHistorico(agora)
    .map((a) => consultas.get(`declaracoes:${a}`))
    .reduce<Date | null>((m, c) => (c?.ok && (!m || c.em > m) ? c.em : m), null);
  const comValores = meses.some((m) => m.receita !== null || m.valorDas !== null);

  return (
    <TelaDoHistorico
      dados={{ linhas: conferenciaDoHistorico(meses, valores, daRotina), mostrarProLabore, importado: meses.some((m) => m.situacao !== "nao-importado"), autorizada }}
      atualizar={autorizada && <BotaoAtualizarHistorico empresaId={empresa.id} atualizar={atualizarHistoricoAcao} />}
      antes={
        <>
          {!autorizada && <FacaNoPortal funcao="declaracaoMensal" situacao={situacao} />}
          <Acompanhar acesso={acesso} etapas={["declaracoes", "extratos", "pagamentos"]} />
        </>
      }
      depois={
        <>
          {/* Gráficos sob demanda (o Chart.js só é baixado quando aparecem), depois da tabela. */}
          {comValores && (
            <Secao titulo="Receita e DAS por mês">
              <div className="grid gap-4 lg:grid-cols-2">
                <GraficoBarras
                  titulo="Receita declarada"
                  descricao="Receita declarada em cada um dos últimos 12 meses"
                  series={[{ chave: "receita", nome: "Receita" }]}
                  pontos={meses.map((m) => ({ chave: m.pa, rotulo: curto(m.pa), nome: rotuloMes(m.pa), valores: { receita: m.receita ?? 0 } }))}
                />
                <GraficoBarras
                  titulo="Valor do DAS"
                  descricao="Valor do DAS de cada um dos últimos 12 meses"
                  series={[{ chave: "das", nome: "DAS" }]}
                  pontos={meses.map((m) => ({ chave: m.pa, rotulo: curto(m.pa), nome: rotuloMes(m.pa), valores: { das: m.valorDas ?? 0 } }))}
                />
              </div>
            </Secao>
          )}
          <ConsultadoEm
            em={consultadoEm}
            rotulo="Quando o Histórico é atualizado?"
            regra={[
              "Os dados ficam guardados. A lista de declarações e os pagamentos são consultados de novo no máximo uma vez por dia, ao abrir esta aba.",
              "O extrato de uma declaração não muda: é buscado uma vez (de novo só se houver retificação).",
              `Para buscar agora, use Atualizar (no máximo a cada ${INTERVALO_MANUAL_MINUTOS} minutos).`,
            ]}
          />
        </>
      }
    />
  );
}
