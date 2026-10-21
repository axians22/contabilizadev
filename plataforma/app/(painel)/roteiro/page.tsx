import { brl, dataBr } from "@contabilizadev/nucleo/formato";
import { mesValido, rotuloMes, somarMeses, vencimentoDarf, vencimentoDas } from "@contabilizadev/nucleo/meses";
import { MOEDAS } from "@contabilizadev/nucleo/ptax";
import { valoresDoDas } from "@contabilizadev/nucleo/serpro/pgdasd";
import { Explicacao } from "@/app/explicacao";
import { Tabela } from "@/app/tabela";
import { Botao, CabecalhoMes, botaoLink } from "@/app/ui";
import { banco } from "@/banco";
import { abaDaEmpresa } from "@/lib/abas";
import { exigirConteudo } from "@/lib/empresas/portao-servidor";
import { enderecoDoDocumento } from "@/lib/historico/documentos";
import { baseDoMes, ultimoMesApuravel } from "@/lib/rotina/base";
import { esperandoOEsocial, motivoParaNaoTransmitirDctf, situacaoDctf } from "@/lib/rotina/dctfweb";
import { motivoParaNaoEnviar, motivoParaNaoRetificar, previaEsocial, situacaoEsocial } from "@/lib/esocial/envio";
import { acompanharAoAbrir, esocialDoServidor } from "@/lib/esocial/servidor";
import { avisoFatorR } from "@/lib/rotina/fator-r";
import { guiaDoMes } from "@/lib/rotina/guias";
import { enviosDoMes, motivoParaNaoTransmitirMes } from "@/lib/rotina/pgdasd";
import { rotinaDoServidor } from "@/lib/rotina/servidor";
import { termoDoServidor } from "@/lib/termo/servidor";
import { situacaoTermo } from "@/lib/termo/termo";
import { FacaNoPortal } from "../faca-no-portal";
import { PortaoFechado } from "../portao";
import {
  conferirDctfAcao,
  gerarGuiaAcao,
  informarProLaboreAcao,
  lancarReceitaAcao,
  marcarSemReceitaAcao,
  prepararDctfAcao,
  removerReceitaAcao,
  simularAcao,
  transmitirAcao,
  transmitirDctfAcao,
  transmitirDctfAssinadaAcao,
} from "./acoes";
import { AssinarDctf, BotaoDeAcao, ConfirmarEnvio, InformarProLabore, LancarReceita } from "./componentes";
import { atualizarEsocialAcao, enviarEsocialAcao, enviarEsocialPelaPlataformaAcao, marcarPortalAcao, prepararEsocialAcao, repetirEsocialAcao } from "../esocial/acoes";
import { PassoEsocial } from "./esocial";
import { GuiaAqui, situacaoDaGuia } from "./guia-aqui";
import { BaseDosDozeMeses, CalculoDoMes, CartaoFatorR, dataDaDeclaracao, Lista, Passo, ResultadoSimulacao, ValoresDaDeclaracao, valoresDoInss } from "./partes";

export const metadata = { title: "Rotina do mês · ContabilizaDev" };

// Rotina do mês (Parte 6, passo 18), na aba Roteiro: é a aba que já dizia "o que fazer a cada mês, na ordem: lançar a
// receita, conferir o cálculo, declarar e pagar" (lib/abas.ts), então a rotina inteira fica aqui, um passo por cartão,
// como o roteiro do ../fiscal. As guias de todos os meses (e as vencidas) aparecem também na aba Guias.
// Só banco ao abrir: nada é consultado na Receita sem um clique (simular, transmitir, gerar guia, conferir). Toda
// transmissão pede a confirmação com o resumo; sem autorização em dia, cada passo que depende da Receita vira o modo
// guiado com os valores prontos para o portal.
export default async function Roteiro({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const { portao } = await exigirConteudo();
  const aba = abaDaEmpresa("/roteiro");
  if (portao.estado !== "liberado") return <PortaoFechado aba={aba} portao={portao} />;
  const { empresa, acesso } = portao;

  const agora = new Date();
  const ultimo = ultimoMesApuravel(agora);
  const pedido = (await searchParams).mes;
  const pa = mesValido(pedido) && pedido <= ultimo ? pedido : ultimo;
  const deps = await rotinaDoServidor(acesso);
  const situacao = await situacaoTermo(await termoDoServidor(), acesso);
  const autorizada = deps.autorizada;

  const base = await baseDoMes(banco(), acesso, pa, agora);
  const envios = await enviosDoMes(banco(), acesso, pa);
  const declarada = Boolean(base.vigente);
  const retificar = declarada;
  const motivo = await motivoParaNaoTransmitirMes(banco(), acesso, base, retificar);
  const simulacao = envios.find((e) => e.etapa === "simulacao" && e.tipo === (retificar ? "retificadora" : "original")) ?? null;
  const transmissao = envios.find((e) => e.etapa === "transmissao" && e.estado === "ok") ?? null;
  const ultimaTransmissao = envios.find((e) => e.etapa === "transmissao") ?? null;
  // eSocial (Parte 7): só banco; os lotes que já podem ser consultados vão em segundo plano.
  await acompanharAoAbrir(acesso);
  const esocial = await esocialDoServidor(acesso);
  const es = await situacaoEsocial(banco(), acesso, pa, agora);
  // A situação dos últimos 12 meses no eSocial (antes na aba eSocial, que agora é só a configuração).
  const mesesEs = [];
  for (let i = 0; i < 12; i++) {
    const mes = somarMeses(ultimo, -i);
    mesesEs.push(mes === pa ? es : await situacaoEsocial(banco(), acesso, mes, agora));
  }
  const motivoEs = motivoParaNaoEnviar(es, agora);
  const motivoRet = motivoParaNaoRetificar(es, agora);
  const previaEs = esocial.propria && motivoEs === null ? await previaEsocial(esocial, acesso, pa, { retificar: false, semPagamentoAnterior: true }) : null;
  const previaRet = esocial.propria && motivoRet === null ? await previaEsocial(esocial, acesso, pa, { retificar: true }) : null;
  const dctf = await situacaoDctf(banco(), acesso, pa, agora);
  const motivoDctf = motivoParaNaoTransmitirDctf(dctf);
  const das = await guiaDoMes(banco(), acesso, pa, "DAS", agora);
  const inss = await guiaDoMes(banco(), acesso, pa, "INSS", agora);
  const fator = pa === ultimo ? await avisoFatorR(banco(), acesso, agora) : null;
  const a = base.apuracao;
  const campos = { empresaId: empresa.id, pa };
  const valores = a ? valoresDoDas(a.das) : {};
  const propria = situacao.estado === "propria";
  // Sem receita lançada nem a marcação de "sem receita", nada é simulado (evita declarar zero por engano). Retificar só faz
  // sentido com receita nova lançada ou marcada como zero.
  const podeSimular = !base.receitaPendente && (!declarada || base.receitaLancada !== null || base.semReceita);
  const venceDas = vencimentoDas(pa);
  const venceDarf = vencimentoDarf(pa);
  // Pró-labore do mês corrente (separado do mês apurado): é o que a sugestão do Fator R pede.
  const mostrarProLaboreAtual = pa === ultimo && base.regra?.tributacao === "fator-r";

  return (
    <>
      <CabecalhoMes mes={pa} rota="/roteiro" sobre={`${empresa.razaoSocial} · rotina do mês`} ate={ultimo} rotuloAtual="Último mês" />
      <p className="flex items-center gap-1 text-sm text-muted">
        {venceDas === venceDarf
          ? `DAS e DARF do INSS de ${rotuloMes(pa)} vencem em ${dataBr(venceDas)}.`
          : `DAS de ${rotuloMes(pa)} vence em ${dataBr(venceDas)}; DARF do INSS, em ${dataBr(venceDarf)}.`}
        <Explicacao
          rotulo="Como funciona a rotina do mês?"
          texto={[
            "Depois que o mês termina: lance a receita que caiu na conta, informe o pró-labore, confira o cálculo, declare (PGDAS-D), gere o DAS, envie o pró-labore ao eSocial (o fechamento manda a DCTFWeb) e gere o DARF do INSS.",
            "Nada é enviado à Receita Federal sem você clicar e confirmar o resumo do que vai ser enviado.",
            "Sem a autorização da empresa, cada passo mostra os valores prontos para você lançar no portal.",
            "Os dois vencem no dia 20 do mês seguinte. Se o dia 20 não for dia útil, o DAS passa para o dia útil seguinte e o DARF do INSS é antecipado para o dia útil anterior.",
          ]}
        />
      </p>

      {fator && (fator.emAtencao || fator.anexo === "V") && <CartaoFatorR aviso={fator} />}

      <Passo
        numero={1}
        titulo="Receita do mês"
        feito={!base.receitaPendente}
        situacao={base.receitaLancada !== null ? `${brl(base.receitaLancada)} lançados` : base.semReceita ? "Sem receita no mês" : declarada ? "Declarada" : "Pendente"}
        explicacao={
          <Explicacao
            rotulo="Qual receita lançar no mês?"
            texto={[
              `O valor que caiu na conta da empresa no Brasil pelo trabalho de ${rotuloMes(pa)} (receita de exportação). Lance depois que o mês termina.`,
              "Recebeu em moeda estrangeira? Informe o valor na moeda e, se souber, o valor em reais creditado; sem ele, convertemos pela PTAX de compra do dia.",
              "Não houve receita no mês? Marque \"Não houve receita\": só assim a declaração com receita zero é liberada.",
              ...(declarada ? [`Este mês já foi declarado com receita de ${brl(base.receitaDeclarada ?? 0)}. Lance aqui só se for retificar.`] : []),
            ]}
          />
        }
      >
        <LancarReceita acao={lancarReceitaAcao} empresaId={empresa.id} pa={pa} hoje={base.hoje} />
        {base.receitaLancada === null &&
          (base.semReceita ? (
            <BotaoDeAcao acao={marcarSemReceitaAcao} campos={{ ...campos, marcar: "nao" }} rotulo="Desfazer: houve receita" pendente="Desfazendo…" leve />
          ) : (
            <BotaoDeAcao acao={marcarSemReceitaAcao} campos={{ ...campos, marcar: "sim" }} rotulo="Não houve receita neste mês" pendente="Marcando…" leve />
          ))}
        <Tabela
          rotulo={`Receitas lançadas em ${rotuloMes(pa)}`}
          vazio={declarada ? `Nenhum lançamento: vale a receita declarada (${brl(base.receitaDeclarada ?? 0)}).` : "Nenhuma receita lançada neste mês."}
          colunas={[
            { chave: "data", titulo: "Caiu em", principal: true },
            { chave: "moeda", titulo: "Valor recebido", alinhar: "direita" },
            { chave: "cotacao", titulo: "Cotação", alinhar: "direita", ocultarNoCelular: true },
            { chave: "reais", titulo: "Em reais", alinhar: "direita" },
            { chave: "obs", titulo: "Observação", ocultarNoCelular: true },
            { chave: "remover", titulo: "" },
          ]}
          linhas={base.lancamentos.map((l) => ({
            chave: l.id,
            celulas: {
              data: dataBr(l.recebidaEm),
              moeda: l.moeda === "BRL" ? brl(l.valorMoeda) : `${l.moeda} ${l.valorMoeda.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
              cotacao:
                l.moeda === "BRL" ? (
                  "—"
                ) : (
                  <span className="inline-flex items-center gap-1">
                    {l.cotacao?.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}
                    <Explicacao
                      rotulo={`De onde vem a cotação do recebimento de ${dataBr(l.recebidaEm)} em ${l.moeda}?`}
                      texto={
                        l.origemValor === "ptax"
                          ? `PTAX de compra do Banco Central de ${dataBr(l.cotacaoData ?? l.recebidaEm)} (${MOEDAS[l.moeda as keyof typeof MOEDAS] ?? l.moeda}).`
                          : "O valor em reais foi informado por você (o que caiu na conta); a cotação é só a divisão."
                      }
                    />
                  </span>
                ),
              reais: brl(l.valorBrl),
              obs: l.observacao ?? "",
              remover: (
                <form action={removerReceitaAcao}>
                  <input type="hidden" name="empresaId" value={empresa.id} />
                  <input type="hidden" name="id" value={l.id} />
                  <Botao leve>Remover</Botao>
                </form>
              ),
            },
          }))}
        />
      </Passo>

      <Passo numero={2} titulo="Pró-labore do mês" feito={base.prolabore !== null} situacao={base.prolabore !== null ? brl(base.prolabore) : "Pendente"}>
        <InformarProLabore acao={informarProLaboreAcao} empresaId={empresa.id} mes={pa} valor={base.prolabore} />
        {base.prolabore !== null && <Lista itens={valoresDoInss(pa, base.prolabore).slice(1, 3)} />}
        {mostrarProLaboreAtual && (
          <div id="prolabore-do-mes-atual" className="scroll-mt-24 border-t border-line pt-4">
            <InformarProLabore
              acao={informarProLaboreAcao}
              empresaId={empresa.id}
              mes={base.mesAtual}
              valor={base.prolaboreDoMesAtual}
              id="prolabore-mes-atual"
              rotulo={`Pró-labore de ${rotuloMes(base.mesAtual)} (mês corrente)`}
              pergunta="Por que informar o pró-labore do mês corrente?"
              explicacao={[
                `O pró-labore de ${rotuloMes(base.mesAtual)} entra no Fator R dos próximos meses: é o único que ainda dá para ajustar para ficar no Anexo III.`,
                `Ele não muda o mês de ${rotuloMes(pa)}, já fechado (o pró-labore acima).`,
              ]}
            />
          </div>
        )}
      </Passo>

      <Passo
        numero={3}
        titulo="Cálculo do DAS"
        feito={simulacao?.estado === "ok" && !simulacao.mensagem}
        situacao={a && !base.receitaPendente ? brl(a.das.total) : "—"}
        explicacao={
          <Explicacao
            rotulo="De onde vêm os números do cálculo?"
            texto={[
              "A receita dos 12 meses anteriores e a folha vêm do que a Receita Federal tem (declarações importadas no Histórico) e do que você lançou aqui.",
              "Antes de declarar, simule na Receita Federal: ela calcula com os mesmos dados, sem registrar nada, e mostramos lado a lado.",
            ]}
          />
        }
      >
        <CalculoDoMes base={base} />
        <BaseDosDozeMeses base={base} />
      </Passo>

      <Passo
        numero={4}
        titulo={retificar ? "Declaração (PGDAS-D): retificar" : "Declaração (PGDAS-D)"}
        feito={declarada}
        situacao={declarada ? `Declarada em ${dataDaDeclaracao(base.vigente!.transmitidaEm)}` : "Pendente"}
        explicacao={
          <Explicacao
            rotulo="Como é feita a declaração mensal?"
            texto={[
              "1. Simular: a Receita Federal calcula com os mesmos dados, sem transmitir.",
              "2. Transmitir: liberado só se a simulação bater com o cálculo daqui, depois da sua confirmação. Um mês não é transmitido duas vezes.",
              "Mês já declarado só recebe retificação (lance a receita correta no passo 1), que substitui a declaração anterior; se o imposto aumentar, gere o DAS da diferença no passo 5.",
            ]}
          />
        }
      >
        {declarada && (
          <Lista
            itens={[
              ["Declaração", `nº ${base.vigente!.numero} (${base.vigente!.tipo === "retificadora" ? "retificadora" : "original"})`],
              ["Receita declarada", base.receitaDeclarada !== null ? brl(base.receitaDeclarada) : "—"],
            ]}
          />
        )}
        {transmissao && (transmissao.temDeclaracao || transmissao.temRecibo) && (
          <div className="flex flex-wrap gap-2">
            {transmissao.temDeclaracao && (
              <a className={botaoLink} href={enderecoDoDocumento("declaracao-pgdasd", transmissao.id)} target="_blank" rel="noopener">
                Declaração (PDF)
              </a>
            )}
            {transmissao.temRecibo && (
              <a className={botaoLink} href={enderecoDoDocumento("recibo-pgdasd", transmissao.id)} target="_blank" rel="noopener">
                Recibo (PDF)
              </a>
            )}
          </div>
        )}
        {autorizada ? (
          a && (
            <div className="flex flex-col gap-3 rounded-xl bg-raised/60 px-4 py-4">
              {podeSimular && (
                <BotaoDeAcao
                  acao={simularAcao}
                  campos={{ ...campos, retificar: retificar ? "sim" : "nao" }}
                  rotulo={simulacao ? "Simular de novo" : retificar ? "Simular a retificação" : "Simular na Receita Federal"}
                  pendente="Simulando…"
                  leve={Boolean(simulacao)}
                />
              )}
              {simulacao?.estado === "ok" && <ResultadoSimulacao simulacao={simulacao} valores={valores} />}
              {simulacao?.mensagem && <p className="text-sm text-bad">{simulacao.mensagem}</p>}
              {(ultimaTransmissao?.estado === "incerto" || ultimaTransmissao?.estado === "erro") && <p className="text-sm text-bad">{ultimaTransmissao.mensagem}</p>}
              {motivo === null ? (
                <ConfirmarEnvio
                  acao={transmitirAcao}
                  campos={{ ...campos, retificar: retificar ? "sim" : "nao", receita: String(base.receita), total: String(a.das.total) }}
                  rotulo={retificar ? "Transmitir a retificação" : "Transmitir a declaração"}
                  titulo={retificar ? `Retificar a declaração de ${rotuloMes(pa)}` : `Declarar ${rotuloMes(pa)}`}
                  perigo={retificar}
                  resumo={[
                    ["Empresa", empresa.razaoSocial],
                    ["Período de apuração", rotuloMes(pa)],
                    ["Receita de exportação", brl(base.receita)],
                    ["Anexo", a.anexo],
                    ["DAS", brl(a.das.total)],
                    ...(retificar ? ([["Substitui a declaração", `nº ${base.vigente!.numero}`]] as [string, string][]) : []),
                  ]}
                  confirmo={
                    base.semReceita
                      ? `Confirmo que a empresa não teve receita em ${rotuloMes(pa)} (declaração com receita zero e DAS de ${brl(a.das.total)}). Sei que a declaração vai para a Receita Federal e só pode ser corrigida por retificação.`
                      : `Confirmo a receita de ${brl(base.receita)} em ${rotuloMes(pa)}, toda de exportação, e o DAS de ${brl(a.das.total)}. Sei que a declaração vai para a Receita Federal e só pode ser corrigida por retificação.`
                  }
                  explicacao={[
                    "A declaração é transmitida à Receita Federal em nome da empresa, com os valores acima (os mesmos da simulação).",
                    "Depois de transmitida, a declaração e o recibo ficam guardados aqui e o DAS pode ser gerado no passo 5.",
                  ]}
                />
              ) : (
                (podeSimular || !declarada) && <p className="text-sm text-muted">{motivo}</p>
              )}
            </div>
          )
        ) : (
          <FacaNoPortal funcao="declaracaoMensal" situacao={situacao}>
            <ValoresDaDeclaracao base={base} />
          </FacaNoPortal>
        )}
      </Passo>

      <Passo numero={5} titulo="Guia do Simples (DAS)" feito={das.paga} situacao={situacaoDaGuia(das)}>
        {autorizada ? (
          <GuiaAqui guia={das} campos={campos} rotulo="Gerar o DAS" gerar={gerarGuiaAcao} />
        ) : (
          <FacaNoPortal funcao="guiaDoMes" situacao={situacao}>
            <Lista
              itens={[
                ["DAS esperado", a && !base.receitaPendente ? brl(a.das.total) : "—"],
                ["Vencimento", dataBr(das.vencimento)],
              ]}
            />
          </FacaNoPortal>
        )}
      </Passo>

      <PassoEsocial
        acoes={{
          preparar: prepararEsocialAcao,
          enviar: enviarEsocialAcao,
          enviarPelaPlataforma: enviarEsocialPelaPlataformaAcao,
          repetir: repetirEsocialAcao,
          atualizar: atualizarEsocialAcao,
          marcarPortal: marcarPortalAcao,
        }}
        numero={6}
        empresa={{ id: empresa.id, cnpj: empresa.cnpj }}
        s={es}
        disponivel={Boolean(esocial.cliente)}
        propria={Boolean(esocial.propria)}
        motivo={motivoEs}
        motivoRetificar={motivoRet}
        previa={previaEs}
        previaRetificacao={previaRet}
        meses={mesesEs}
      />

      <Passo
        numero={7}
        titulo="DCTFWeb e DARF do INSS"
        feito={dctf.transmitida}
        situacao={dctf.transmitida ? `Transmitida${dctf.recibo ? ` · recibo ${dctf.recibo}` : ""}` : "Pendente"}
        explicacao={
          <Explicacao
            rotulo="O que é a DCTFWeb do mês?"
            texto={[
              "A DCTFWeb é montada pela Receita Federal a partir do eSocial: o pró-labore precisa estar lançado e a folha fechada no eSocial antes (passo 6).",
              "Fechado pelo passo 6, o próprio eSocial transmite a DCTFWeb: aqui só conferimos e geramos o DARF, sem assinar de novo.",
              "Conferimos a declaração (situação e valor), e ela só é transmitida se o INSS bater com 11% do pró-labore informado no passo 2 (limitado ao teto do INSS). Depois, o DARF do INSS.",
              "Já transmitida, a correção do pró-labore é feita pela retificação no passo 6: o novo fechamento manda a DCTFWeb retificadora.",
            ]}
          />
        }
      >
        {autorizada ? (
          <div className="flex flex-col gap-3 rounded-xl bg-raised/60 px-4 py-4">
            {(!dctf.transmitida || dctf.transmissao?.estado === "incerto") && (
              <BotaoDeAcao acao={conferirDctfAcao} campos={campos} rotulo={dctf.conferencia ? "Conferir de novo" : "Conferir a declaração"} pendente="Conferindo…" leve={Boolean(dctf.conferencia)} />
            )}
            {dctf.conferencia && (
              <Lista
                itens={[
                  ["Situação", dctf.conferencia.situacao === "transmitida" ? "Transmitida" : "Em andamento (ainda não transmitida)"],
                  ["Valor a pagar na declaração", brl(dctf.conferencia.aPagar ?? 0)],
                  ["INSS esperado do pró-labore", dctf.inssEsperado !== null ? brl(dctf.inssEsperado) : "informe o pró-labore no passo 2"],
                ]}
              />
            )}
            {dctf.ultimaFalha?.mensagem && <p className="text-sm text-bad">{dctf.ultimaFalha.mensagem}</p>}
            {motivoDctf === null ? (
              propria ? (
                <ConfirmarEnvio
                  acao={transmitirDctfAcao}
                  campos={{ ...campos, aPagar: String(dctf.conferencia!.aPagar ?? 0) }}
                  rotulo="Transmitir a DCTFWeb"
                  titulo={`Transmitir a DCTFWeb de ${rotuloMes(pa)}`}
                  resumo={[
                    ["Empresa", empresa.razaoSocial],
                    ["Período de apuração", rotuloMes(pa)],
                    ["Valor a pagar (INSS)", brl(dctf.conferencia!.aPagar ?? 0)],
                  ]}
                  confirmo={`Confirmo a DCTFWeb de ${rotuloMes(pa)} com ${brl(dctf.conferencia!.aPagar ?? 0)} de INSS a pagar. Sei que ela será assinada com o certificado da empresa e enviada à Receita Federal.`}
                  explicacao={["A declaração conferida é assinada com o certificado digital da empresa e transmitida. Depois, o DARF do INSS pode ser gerado."]}
                />
              ) : (
                <AssinarDctf
                  empresaId={empresa.id}
                  cnpj={empresa.cnpj}
                  pa={pa}
                  resumo={[
                    ["Empresa", empresa.razaoSocial],
                    ["Período de apuração", rotuloMes(pa)],
                  ]}
                  preparar={prepararDctfAcao}
                  transmitir={transmitirDctfAssinadaAcao}
                />
              )
            ) : (
              (dctf.conferencia || dctf.peloEsocial || dctf.esocialEmCurso) && !dctf.transmitida && <p className="text-sm text-muted">{motivoDctf}</p>
            )}
            {dctf.transmitida && <GuiaAqui guia={inss} campos={campos} rotulo="Gerar o DARF do INSS" gerar={gerarGuiaAcao} />}
          </div>
        ) : (
          <FacaNoPortal funcao="dctfweb" situacao={situacao}>
            {esperandoOEsocial(dctf) && (
              <p className="text-sm">
                {dctf.esocialEmCurso ? "A DCTFWeb deste mês vai ser transmitida pelo eSocial no fechamento (passo 6)" : "A DCTFWeb deste mês foi enviada pelo eSocial no fechamento (passo 6)"}: no e-CAC, confira e emita o DARF.
              </p>
            )}
            <Lista itens={valoresDoInss(pa, base.prolabore)} />
          </FacaNoPortal>
        )}
      </Passo>
    </>
  );
}
