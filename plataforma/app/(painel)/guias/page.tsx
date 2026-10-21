import Link from "next/link";
import { brl, dataBr } from "@contabilizadev/nucleo/formato";
import { rotuloMes } from "@contabilizadev/nucleo/meses";
import { Explicacao } from "@/app/explicacao";
import { Tabela } from "@/app/tabela";
import { Cartao, Secao, Titulo, botaoLink } from "@/app/ui";
import { banco } from "@/banco";
import { abaDaEmpresa } from "@/lib/abas";
import { exigirConteudo } from "@/lib/empresas/portao-servidor";
import { enderecoDoDocumento } from "@/lib/historico/documentos";
import { ehComprovante, guiasDaEmpresa, guiasVencidas } from "@/lib/rotina/guias";
import { termoDoServidor } from "@/lib/termo/servidor";
import { liberada } from "@/lib/termo/situacao";
import { situacaoTermo } from "@/lib/termo/termo";
import { BotoesDaGuia } from "../botoes-da-guia";
import { FacaNoPortal } from "../faca-no-portal";
import { PortaoFechado } from "../portao";
import { gerarGuiaAcao } from "../roteiro/acoes";
import { GuiaAqui } from "../roteiro/guia-aqui";

export const metadata = { title: "Guias · ContabilizaDev" };

const NOME = { DAS: "DAS (Simples)", INSS: "DARF do INSS" } as const;

// Guias: as geradas aqui (DAS e DARF do INSS, com o PDF guardado) e as vencidas sem pagamento dos últimos 12 meses, com a
// guia atualizada com multa e juros para o dia escolhido (como o ../fiscal, app/guias e guia-vencida.tsx). A guia do mês
// é gerada na rotina do mês (aba Roteiro). Só banco ao abrir; gerar é um clique. Sem autorização, o modo guiado.
export default async function Guias() {
  const { portao } = await exigirConteudo();
  const aba = abaDaEmpresa("/guias");
  if (portao.estado !== "liberado") return <PortaoFechado aba={aba} portao={portao} />;
  const { empresa, acesso } = portao;
  const situacao = await situacaoTermo(await termoDoServidor(), acesso);
  const autorizada = liberada(situacao);
  const agora = new Date();
  const geradas = await guiasDaEmpresa(banco(), acesso);
  const vencidas = autorizada ? await guiasVencidas(banco(), acesso, agora) : [];

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <Titulo
          sobre={empresa.razaoSocial}
          explicacao={
            <Explicacao
              rotulo="O que aparece em Guias?"
              texto={[
                "As guias de pagamento geradas aqui: o DAS do Simples e o DARF do INSS do pró-labore, com o PDF para abrir, imprimir ou baixar.",
                "Guia que passou do vencimento sem pagamento aparece em destaque, com a opção de gerar outra com multa e juros para o dia em que você vai pagar.",
              ]}
            />
          }
        >
          {aba.nome}
        </Titulo>
        <Link className={botaoLink} href="/roteiro">
          Rotina do mês
        </Link>
      </div>

      {!autorizada && <FacaNoPortal funcao="guiaDoMes" situacao={situacao} />}

      {vencidas.length > 0 && (
        <Secao titulo="Vencidas e sem pagamento">
          <div className="grid gap-3 lg:grid-cols-2">
            {vencidas.map((g) => (
              <div key={`${g.pa}-${g.tipo}`} id={`guia-${g.tipo}-${g.pa}`} className="scroll-mt-24">
                <Cartao className="flex h-full flex-col gap-3 border-bad/40 px-5 py-4">
                  <span className="text-sm font-semibold first-letter:uppercase">{`${NOME[g.tipo]} de ${rotuloMes(g.pa)} · venceu em ${dataBr(g.vencimento)}`}</span>
                  <GuiaAqui guia={g} campos={{ empresaId: empresa.id, pa: g.pa }} rotulo="Gerar" gerar={gerarGuiaAcao} />
                </Cartao>
              </div>
            ))}
          </div>
        </Secao>
      )}

      <Tabela
        rotulo="Guias geradas"
        porPagina={10}
        vazio="Nenhuma guia gerada aqui ainda. A guia do mês é gerada na rotina do mês."
        colunas={[
          { chave: "mes", titulo: "Mês", principal: true },
          { chave: "guia", titulo: "Guia" },
          { chave: "pagar", titulo: "Pagar até" },
          { chave: "valor", titulo: "Valor", alinhar: "direita" },
          { chave: "pdf", titulo: "Guia" },
        ]}
        linhas={geradas.map((g) => ({
          chave: g.id,
          celulas: {
            mes: <span className="first-letter:uppercase">{rotuloMes(g.pa)}</span>,
            guia: ehComprovante(g) ? `${NOME[g.tipo]} · comprovante de pagamento` : g.pagarEm ? `${NOME[g.tipo]} com multa e juros` : NOME[g.tipo],
            pagar: ehComprovante(g) ? (g.vencimento ? `Pago em ${dataBr(g.vencimento)}` : "Pago") : g.pagarEm ? dataBr(g.pagarEm) : g.vencimento ? dataBr(g.vencimento) : "—",
            valor: g.total !== null ? brl(g.total) : "—",
            pdf: (
              <BotoesDaGuia
                botoes={{ modo: "guardada", rotulo: ehComprovante(g) ? "Ver comprovante" : "Abrir guia", abrir: enderecoDoDocumento("guia", g.id), baixar: enderecoDoDocumento("guia", g.id), explicacao: null }}
                nome={`${NOME[g.tipo]} de ${rotuloMes(g.pa)}`}
                compacto
              />
            ),
          },
        }))}
      />
    </>
  );
}
