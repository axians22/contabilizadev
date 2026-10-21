import Link from "next/link";
import { rotuloMes } from "@contabilizadev/nucleo/meses";
import { Explicacao } from "@/app/explicacao";
import { Tabela } from "@/app/tabela";
import { Campo, Secao, Titulo } from "@/app/ui";
import { banco } from "@/banco";
import { abaDaEmpresa } from "@/lib/abas";
import { explicacaoDoLucroAcima } from "@/lib/defis/limite";
import { entregaDaDeclaracaoAnual, inicioNoSimples, situacaoDaDeclaracaoAnual } from "@/lib/defis/prazo";
import { anosDaDeclaracao, dadosDoCliente, faltando, resumoDaDeclaracaoAnual } from "@/lib/defis/resumo";
import { exigirConteudo } from "@/lib/empresas/portao-servidor";
import { ultimaConsulta } from "@/lib/empresas/receita";
import { defisDaEmpresa, importacaoDaEmpresa } from "@/lib/historico/leitura";
import { hojeNoBrasil, INTERVALO_MANUAL_MINUTOS } from "@/lib/historico/prazos";
import { atualizarAoAbrir } from "@/lib/historico/servidor";
import { termoDoServidor } from "@/lib/termo/servidor";
import { liberada } from "@/lib/termo/situacao";
import { situacaoTermo } from "@/lib/termo/termo";
import { FacaNoPortal } from "../faca-no-portal";
import { atualizarDefisAcao } from "../historico/acoes";
import { Acompanhar, ConsultadoEm, quando } from "../historico/acompanhar";
import { BotaoAtualizarHistorico } from "../historico/botao-atualizar";
import { PortaoFechado } from "../portao";
import { BotaoDeAcao } from "../roteiro/componentes";
import { salvarDefisAcao } from "./acoes";
import { CartaoUltimaDefis, Pdfs } from "./cartao-defis";
import { CartaoDaDeclaracaoAnual, DefisNaoEncontrada, ValoresDoAno } from "./declaracao-anual";

export const metadata = { title: "Declaração anual · ContabilizaDev" };

const NOMES_DOS_CAMPOS = { lucros: "lucros retirados", saldoInicial: "saldo do início do ano", saldoFinal: "saldo do fim do ano", despesas: "despesas do ano" } as const;

// Declaração anual (DEFIS): o prazo do ano que fechou e se a Receita já tem a declaração entregue (banco primeiro:
// consultada sozinha uma vez por ano depois do prazo, ou pelo botão Atualizar), os valores do ano prontos para lançar no
// Portal do Simples Nacional (modo guiado: a plataforma não transmite a DEFIS) e o que só o cliente sabe (lucros, saldos,
// despesas), guardado aqui. A última DEFIS entregue e as consultadas, com a declaração e o recibo em PDF.
export default async function DeclaracaoAnual({ searchParams }: { searchParams: Promise<{ ano?: string }> }) {
  const { portao } = await exigirConteudo();
  const aba = abaDaEmpresa("/defis");
  if (portao.estado !== "liberado") return <PortaoFechado aba={aba} portao={portao} />;
  const { empresa, acesso } = portao;
  const agora = new Date();
  const anos = anosDaDeclaracao(agora);
  const pedido = Number((await searchParams).ano);
  const ano = anos.includes(pedido) ? pedido : anos[0];
  const situacao = await situacaoTermo(await termoDoServidor(), acesso);
  const autorizada = liberada(situacao);
  if (autorizada) await atualizarAoAbrir(acesso, ["defis"]);
  const [lista, resumo, dados, consulta] = await Promise.all([
    defisDaEmpresa(banco(), acesso),
    resumoDaDeclaracaoAnual(banco(), acesso, ano),
    dadosDoCliente(banco(), acesso, ano),
    ultimaConsulta(banco(), acesso),
  ]);
  // Desde quando a empresa está no Simples: os anos antes disso não têm declaração devida.
  const inicio = inicioNoSimples(consulta?.dados);
  const doAnoQueFechou = lista.find((d) => d.ano === anos[0]);
  const prazo = situacaoDaDeclaracaoAnual(hojeNoBrasil(agora), entregaDaDeclaracaoAnual(anos[0], doAnoQueFechou), inicio);
  const doAno = lista.find((d) => d.ano === ano);
  const importacao = autorizada && lista.length === 0 ? await importacaoDaEmpresa(banco(), acesso, agora) : null;
  const consultando = Boolean(importacao?.rodando && importacao.etapas.some((e) => e.id === "defis" && (e.estado === "pendente" || e.estado === "rodando")));
  const falta = faltando(dados);
  const lucroAcima = dados.lucros !== null && dados.lucros > resumo.limiteLucroIsento;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <Titulo
          sobre={empresa.razaoSocial}
          explicacao={
            <Explicacao
              rotulo="O que é a declaração anual (DEFIS)?"
              texto={[
                "A DEFIS é a declaração anual do Simples Nacional: resume o ano anterior (receitas, sócios, pró-labore e lucros distribuídos, saldos do banco).",
                "É entregue uma vez por ano, até 31 de março, no Portal do Simples Nacional. Os números precisam bater com o Imposto de Renda do sócio.",
              ]}
            />
          }
        >
          {aba.nome}
        </Titulo>
        {autorizada && <BotaoAtualizarHistorico empresaId={empresa.id} atualizar={atualizarDefisAcao} />}
      </div>

      <Acompanhar acesso={acesso} etapas={["defis"]} />

      <section className="grid gap-3 sm:grid-cols-2" aria-label="Declaração do ano">
        <CartaoDaDeclaracaoAnual s={prazo} />
        <CartaoUltimaDefis lista={lista} autorizada={autorizada} consultando={consultando} />
      </section>

      <nav className="flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none]" aria-label="Declaração anual por ano">
        {anos.map((a) => (
          <Link
            key={a}
            href={`/defis?ano=${a}`}
            scroll={false}
            aria-current={a === ano ? "page" : undefined}
            className={`-mb-px shrink-0 border-b-2 px-3 pb-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink ${a === ano ? "border-fg text-fg" : "border-transparent text-muted hover:text-fg"}`}
          >
            {a}
          </Link>
        ))}
      </nav>

      <DefisNaoEncontrada ano={ano} registro={doAno} inicio={inicio} />

      <Secao
        titulo={`Valores de ${ano}`}
        explicacao={
          <Explicacao
            rotulo={`De onde vêm os valores de ${ano}?`}
            texto={[
              "Do que a plataforma já tem: as declarações mensais importadas da Receita Federal (ou a receita lançada aqui), o pró-labore informado e o DAS de cada mês.",
              ...(resumo.semReceita.length ? [`Meses sem receita aqui: ${resumo.semReceita.map(rotuloMes).join(", ")}. Se houve receita, confira no Histórico.`] : []),
              ...(resumo.semProLabore.length ? [`Meses sem pró-labore conhecido: ${resumo.semProLabore.map(rotuloMes).join(", ")}.`] : []),
            ]}
          />
        }
      >
        <ValoresDoAno ano={ano} r={resumo} />
      </Secao>

      <Secao
        titulo="O que só você sabe"
        explicacao={
          <Explicacao
            rotulo="Onde achar os valores que só você sabe?"
            texto={[
              "No extrato do banco da empresa.",
              "Lucros retirados: o que saiu da conta da empresa para a sua além do pró-labore.",
              "Despesas: tudo o que a empresa pagou no ano (DAS, INSS, pró-labore, certificado, tarifas).",
              "Os valores ficam guardados só aqui, para você lançar no portal; nada é enviado à Receita.",
            ]}
          />
        }
      >
        <BotaoDeAcao acao={salvarDefisAcao} campos={{ empresaId: empresa.id, ano: String(ano) }} rotulo="Guardar" pendente="Guardando…">
          <div className="grid w-full gap-4 sm:grid-cols-2">
            <Campo rotulo={`Lucros retirados em ${ano} (R$)`} id="lucros" name="lucros" type="number" step="0.01" min="0" inputMode="decimal" defaultValue={dados.lucros ?? ""} />
            <Campo rotulo="Despesas do ano (R$)" id="despesas" name="despesas" type="number" step="0.01" min="0" inputMode="decimal" defaultValue={dados.despesas ?? ""} />
            <Campo rotulo={`Saldo no banco em 01/01/${ano} (R$)`} id="saldoInicial" name="saldoInicial" type="number" step="0.01" min="0" inputMode="decimal" defaultValue={dados.saldoInicial ?? ""} />
            <Campo rotulo={`Saldo no banco em 31/12/${ano} (R$)`} id="saldoFinal" name="saldoFinal" type="number" step="0.01" min="0" inputMode="decimal" defaultValue={dados.saldoFinal ?? ""} />
          </div>
        </BotaoDeAcao>
        {lucroAcima && (
          <p className="text-sm">
            <b className="font-semibold text-warn">Lucro acima do limite isento.</b>{" "}
            <Explicacao
              rotulo="O que fazer com lucro acima do limite isento?"
              texto={explicacaoDoLucroAcima(ano)}
            />
          </p>
        )}
        {falta.length > 0 && <p className="text-sm text-muted">Falta: {falta.map((c) => NOMES_DOS_CAMPOS[c]).join(", ")}.</p>}
      </Secao>

      <FacaNoPortal
        funcao="declaracaoAnual"
        motivo="Você entrega no portal, com os valores acima."
        explicacao="A plataforma reúne os valores do ano e guarda o que você informou; a entrega é feita por você no portal, com o certificado digital ou o código de acesso. Depois, a consulta à Receita Federal mostra a declaração entregue aqui."
        rodape={<span className="text-muted">{autorizada ? "Depois de entregar, use Atualizar para ver a declaração aqui." : "Depois de entregar, a declaração aparece aqui com a autorização em dia."}</span>}
      />

      {lista.length > 0 && (
        <Tabela
          rotulo="DEFIS consultadas"
          colunas={[
            { chave: "ano", titulo: "Ano", principal: true },
            { chave: "situacao", titulo: "Situação" },
            { chave: "pdfs", titulo: "PDF" },
            { chave: "consultada", titulo: "Consultada em" },
          ]}
          linhas={lista.map((d) => ({
            chave: d.id,
            celulas: {
              ano: String(d.ano),
              situacao: d.situacao === "entregue" ? "Entregue" : "Não encontrada",
              pdfs: <Pdfs d={d} />,
              consultada: quando(d.consultadaEm),
            },
          }))}
        />
      )}

      <ConsultadoEm
        em={lista.reduce<Date | null>((m, d) => (!m || d.consultadaEm > m ? d.consultadaEm : m), null)}
        rotulo="Quando a declaração anual é atualizada?"
        regra={[
          "A DEFIS fica guardada. É consultada sozinha uma vez por ano, depois do prazo de entrega (31 de março).",
          `Para consultar agora (por exemplo, depois de entregar ou retificar), use Atualizar (no máximo a cada ${INTERVALO_MANUAL_MINUTOS} minutos).`,
        ]}
      />
    </>
  );
}
