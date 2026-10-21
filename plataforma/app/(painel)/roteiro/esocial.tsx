import Link from "next/link";
import { brl, dataBr, formatarCpf } from "@contabilizadev/nucleo/formato";
import { fimDoMes, rotuloMes } from "@contabilizadev/nucleo/meses";
import { Explicacao } from "@/app/explicacao";
import { Tabela } from "@/app/tabela";
import type { ResumoEsocial, SituacaoEsocial } from "@/lib/esocial/envio";
import { MENSAGENS_DO_ESOCIAL } from "@/lib/esocial/mensagens";
import { linhasDoResumo } from "@/lib/esocial/resumo";
import type { EstadoEsocial, PreparoNaTela } from "../esocial/acoes";
import { AssinarEsocial, AtualizarSozinho } from "../esocial/componentes";
import { FacaNoPortal } from "../faca-no-portal";
import { BotaoDeAcao, ConfirmarEnvio } from "./componentes";
import { Lista, Passo } from "./partes";

// Passo do eSocial na rotina do mês (Parte 7, passos 20 e 21), antes da DCTFWeb: o pró-labore do mês (S-1200), o
// pagamento feito no mês (S-1210) e o fechamento (S-1299), que pede a transmissão da DCTFWeb. O cliente assina aqui no
// navegador (uma assinatura por mês) e a plataforma envia; a empresa da plataforma assina no servidor. Sempre com a
// alternativa de lançar no portal do eSocial com os valores prontos. No fim do passo, a situação dos últimos 12 meses no
// eSocial (antes na aba eSocial, que agora é só a configuração).

type AcaoDeFormulario = (anterior: EstadoEsocial, dados: FormData) => Promise<EstadoEsocial>;
export type AcoesDoEsocial = {
  preparar: (empresaId: string, mes: string, certificado: string, opcoes: { retificar?: boolean; dtPgto?: string | null; semPagamentoAnterior?: boolean }) => Promise<PreparoNaTela>;
  enviar: (empresaId: string, mes: string, envio: { envioId: string; assinaturas: { idEvento: string; valor: string }[]; proLabore: number; confirmado: boolean }) => Promise<EstadoEsocial>;
  enviarPelaPlataforma: AcaoDeFormulario;
  repetir: AcaoDeFormulario;
  atualizar: AcaoDeFormulario;
  marcarPortal: AcaoDeFormulario;
};

type Props = {
  acoes: AcoesDoEsocial;
  numero: number;
  empresa: { id: string; cnpj: string };
  s: SituacaoEsocial;
  disponivel: boolean; // o certificado da plataforma (transmissor) está configurado
  propria: boolean;
  motivo: string | null; // para não enviar o mês
  motivoRetificar: string | null;
  previa: ResumoEsocial | null; // a confirmação da empresa da plataforma
  previaRetificacao: ResumoEsocial | null;
  meses?: SituacaoEsocial[]; // os últimos 12 meses, do mais recente ao mais antigo
};

const ESTADO_DO_ENVIO: Record<string, string> = {
  enviando: "Enviando ao eSocial…",
  aguardando: "O eSocial está processando",
  incerto: "Envio sem resposta do eSocial",
};

function situacaoDoPasso(s: SituacaoEsocial): string {
  if (s.portal) return "Lançado no portal";
  if (s.concluido) return s.remuneracao?.estado === "importado" ? "Enviado pelo contador" : "Enviado";
  if (s.emAndamento) return ESTADO_DO_ENVIO[s.emAndamento.estado];
  return `Prazo ${dataBr(s.prazo)}`;
}

// A situação de um mês na tabela dos últimos 12 meses.
export function situacaoDoMes(s: SituacaoEsocial): string {
  if (s.portal) return "Lançado no portal";
  if (s.concluido) return s.remuneracao?.estado === "importado" ? "Enviado pelo contador" : "Enviado e fechado";
  if (s.emAndamento) return s.emAndamento.estado === "incerto" ? "Sem resposta: enviar de novo" : "Em processamento";
  if (s.envio?.estado === "recusado") return "Recusado";
  if (s.remuneracao) return "Falta fechar o mês";
  if (!s.proLabore) return "Sem pró-labore informado";
  return "A enviar";
}

// Os últimos 12 meses no eSocial: pró-labore, situação, prazo e recibo; cada mês abre a rotina dele (este passo).
const MESES_POR_PAGINA = 6;

export function MesesNoEsocial({ meses, atual }: { meses: SituacaoEsocial[]; atual: string }) {
  // Abre na página do mês aberto, para ele ficar à vista mesmo quando é antigo.
  const indice = meses.findIndex((m) => m.mes === atual);
  const paginaInicial = indice < 0 ? 1 : Math.floor(indice / MESES_POR_PAGINA) + 1;
  return (
    <details className="border-t border-line pt-3">
      <summary className="cursor-pointer text-sm font-medium">Os últimos 12 meses no eSocial</summary>
      <div className="flex flex-col gap-2 pt-3">
        <p className="flex items-center gap-1 text-sm text-muted">
          A situação do pró-labore de cada mês.
          <Explicacao rotulo="O que mostra a tabela?" texto="A situação do pró-labore de cada mês no eSocial, o prazo (dia 15 do mês seguinte, ou o dia útil seguinte) e o recibo. Clique no mês para abrir a rotina dele e enviar." />
        </p>
        {/* key={atual}: trocar o mês (cabeçalho ou a própria tabela) só muda o ?mes=, e o Next não remonta a página por
            isso; sem a chave a tabela ficaria na página antiga, com o mês aberto fora da vista. */}
        <Tabela
          key={atual}
          rotulo="Meses no eSocial"
          porPagina={MESES_POR_PAGINA}
          paginaInicial={paginaInicial}
          colunas={[
            { chave: "mes", titulo: "Mês", principal: true },
            { chave: "prolabore", titulo: "Pró-labore", alinhar: "direita" },
            { chave: "situacao", titulo: "Situação" },
            { chave: "prazo", titulo: "Prazo", ocultarNoCelular: true },
            { chave: "recibo", titulo: "Recibo", ocultarNoCelular: true },
          ]}
          linhas={meses.map((m) => ({
            chave: m.mes,
            destaque: m.mes === atual,
            celulas: {
              mes: (
                <Link href={`/roteiro?mes=${m.mes}#passo-6`} aria-current={m.mes === atual ? "page" : undefined} className="underline underline-offset-2">
                  {rotuloMes(m.mes)}
                </Link>
              ),
              prolabore: m.proLabore !== null ? brl(m.proLabore) : "—",
              situacao: situacaoDoMes(m),
              prazo: dataBr(m.prazo),
              recibo: m.remuneracao?.recibo ?? "—",
            },
          }))}
        />
      </div>
    </details>
  );
}

// Os valores para lançar no portal (passo 21): rubricas, valores e datas, do cadastro e do pró-labore do mês.
function ValoresParaOPortal({ s }: { s: SituacaoEsocial }) {
  const c = s.config;
  const v = s.valores;
  const itens: [string, string][] = [
    ...(c ? ([["Sócio (CPF)", formatarCpf(c.cpf)], ["Categoria e matrícula", `${c.categoria} · matrícula ${c.matricula}`], ["Lotação", c.lotacao]] as [string, string][]) : []),
    [c ? `Rubrica ${c.rubricaProLabore} (tabela ${c.tabRubrica}): pró-labore` : "Pró-labore", v ? `${brl(v.proLabore)}${c?.qtdProLabore ? ` · quantidade ${c.qtdProLabore.replace(".", ",")}` : ""}` : "informe no passo 2"],
    [c ? `Rubrica ${c.rubricaInss}: INSS descontado (11%)` : "INSS descontado (11%)", v ? brl(v.inss) : "—"],
    ...(s.pagamento ? ([["Pagamento no mês (líquido)", `${brl(s.pagamento.liquido)} em ${dataBr(s.pagamento.dtPgto)}, do pró-labore de ${rotuloMes(s.pagamento.perRef)}`]] as [string, string][]) : []),
    ["Prazo", dataBr(s.prazo)],
  ];
  return <Lista itens={itens} />;
}

export function PassoEsocial({ acoes, numero, empresa, s, disponivel, propria, motivo, motivoRetificar, previa, previaRetificacao, meses }: Props) {
  const campos = { empresaId: empresa.id, mes: s.mes };
  const ultimo = s.envio;
  const recusado = ultimo?.estado === "recusado" && !s.emAndamento ? ultimo : null;
  const processando = s.emAndamento && s.emAndamento.estado !== "incerto" ? s.emAndamento : null;
  const pagamento = s.pagamento && !s.pagamentoAceito ? { dtPgto: s.pagamento.dtPgto, min: `${s.mes}-01`, max: fimDoMes(`${s.mes}-01`) } : null;
  const podeAqui = disponivel && Boolean(s.config);

  const enviar = (retificar: boolean, resumo: ResumoEsocial | null) =>
    propria ? (
      resumo && (
        <ConfirmarEnvio
          acao={acoes.enviarPelaPlataforma}
          campos={{ ...campos, retificar: retificar ? "sim" : "nao", proLabore: String(resumo.proLabore), semPagamentoAnterior: resumo.semPagamentoDe ? "sim" : "nao" }}
          rotulo={retificar ? "Retificar no eSocial" : "Enviar ao eSocial"}
          titulo={retificar ? `Retificar o pró-labore de ${rotuloMes(s.mes)} no eSocial` : `Enviar ${rotuloMes(s.mes)} ao eSocial`}
          perigo={retificar}
          pendente="Enviando ao eSocial…"
          resumo={linhasDoResumo(resumo)}
          confirmo={`Confirmo o pró-labore de ${brl(resumo.proLabore)} em ${rotuloMes(s.mes)}. Sei que os eventos serão assinados com o certificado da empresa e enviados ao eSocial.`}
          explicacao={[
            "Os eventos são assinados com o certificado digital da empresa e enviados ao eSocial, um lote de cada vez.",
            "O fechamento do mês pede a transmissão da DCTFWeb do INSS.",
          ]}
        />
      )
    ) : (
      <AssinarEsocial
        empresaId={empresa.id}
        cnpj={empresa.cnpj}
        mes={s.mes}
        retificar={retificar}
        pagamento={retificar ? null : pagamento}
        semDemonstrativoAnterior={retificar ? null : s.semDemonstrativoAnterior}
        rotulo={retificar ? "Assinar e retificar" : "Assinar e enviar ao eSocial"}
        preparar={acoes.preparar}
        enviar={acoes.enviar}
      />
    );

  return (
    <Passo
      numero={numero}
      titulo="eSocial (pró-labore)"
      feito={s.concluido}
      situacao={situacaoDoPasso(s)}
      explicacao={
        <Explicacao
          rotulo="O que vai ao eSocial todo mês?"
          texto={[
            "O pró-labore do sócio: a remuneração do mês, o pagamento feito no mês e o fechamento. É o fechamento que manda a DCTFWeb do INSS, por isso este passo vem antes dela.",
            `Prazo: dia 15 do mês seguinte (o de ${rotuloMes(s.mes)} vence em ${dataBr(s.prazo)}).`,
            "Você assina aqui, com o certificado da empresa, uma vez por mês; a plataforma envia ao eSocial e acompanha o resultado. O arquivo, a chave e a senha do certificado não saem do seu computador. Não precisa de procuração. Prefere fazer por conta própria? Use o portal do eSocial com os valores prontos.",
          ]}
        />
      }
    >
      <ValoresParaOPortal s={s} />
      <AtualizarSozinho ligado={Boolean(processando)} />

      {podeAqui && (
        <div className="flex flex-col gap-3 rounded-xl bg-raised/60 px-4 py-4">
          {processando && (
            <>
              <p role="status" className="text-sm">
                {ESTADO_DO_ENVIO[processando.estado]}
                {processando.totalLotes > 1 ? ` (lote ${processando.loteAtual} de ${processando.totalLotes})` : ""}. O resultado aparece aqui sozinho.
              </p>
              <BotaoDeAcao acao={acoes.atualizar} campos={{ ...campos, envioId: processando.id }} rotulo="Atualizar o resultado" pendente="Consultando…" leve />
            </>
          )}
          {s.emAndamento?.estado === "incerto" && (
            <>
              <p className="flex items-center gap-1 text-sm text-bad">
                {MENSAGENS_DO_ESOCIAL.incerto}
                <Explicacao
                  rotulo="Enviar de novo não duplica?"
                  texto="Não: vão os mesmos eventos já assinados. Se o eSocial já tinha recebido, ele só devolve o recibo do que já tem."
                />
              </p>
              <BotaoDeAcao acao={acoes.repetir} campos={{ ...campos, envioId: s.emAndamento.id }} rotulo="Enviar de novo" pendente="Enviando…" />
            </>
          )}
          {recusado && (
            <p className="flex items-center gap-1 text-sm text-bad">
              {recusado.mensagem}
              {recusado.ocorrencias?.length ? (
                <Explicacao rotulo="O que o eSocial respondeu?" titulo="Resposta do eSocial" texto={recusado.ocorrencias.map((o) => `${o.evento === "lote" ? "Envio" : o.evento}: ${o.descricao}${o.codigo ? ` (código ${o.codigo})` : ""}`)} />
              ) : null}
            </p>
          )}
          {s.concluido && !s.portal && s.remuneracao?.recibo && (
            <p className="text-sm text-accent-ink">
              Remuneração no eSocial · recibo {s.remuneracao.recibo}
              {s.remuneracao.valores?.proLabore !== undefined ? ` · ${brl(s.remuneracao.valores.proLabore)}` : ""}
            </p>
          )}
          {motivo === null && s.semDemonstrativoAnterior && (
            <p className="flex flex-wrap items-center gap-1 text-sm text-bad">
              O envio do pró-labore de {rotuloMes(s.semDemonstrativoAnterior)} não está aqui: o pagamento dele, feito neste mês, não vai junto.
              <Explicacao
                rotulo="O que fazer?"
                texto={[
                  `Pelo cadastro, o pró-labore é pago no mês seguinte: o de ${rotuloMes(s.semDemonstrativoAnterior)} foi pago em ${rotuloMes(s.mes)}, e o eSocial pede esse pagamento ligado ao envio daquele mês.`,
                  `Se o contador enviou ${rotuloMes(s.semDemonstrativoAnterior)}, importe esse mês do eSocial na aba eSocial: o pagamento vai junto no fechamento.`,
                  "Se aquele pró-labore não foi ao eSocial, confirme que o mês fecha sem esse pagamento.",
                ]}
              />
              <Link href="/esocial" className="font-medium underline underline-offset-2">
                Importar {rotuloMes(s.semDemonstrativoAnterior)}
              </Link>
            </p>
          )}
          {motivo === null ? enviar(false, previa) : !processando && !s.emAndamento && !s.concluido && <p className="text-sm text-muted">{motivo}</p>}
          {motivoRetificar === null && (
            <details className="flex flex-col gap-3 border-t border-line pt-3">
              <summary className="cursor-pointer text-sm font-medium">Retificar o pró-labore enviado</summary>
              <p className="flex items-center gap-1 pt-2 text-sm text-muted">
                O pró-labore no eSocial ({brl(s.remuneracao?.valores?.proLabore ?? 0)}) é diferente do informado ({brl(s.proLabore ?? 0)}).
                <Explicacao
                  rotulo="Como funciona a retificação?"
                  texto={[
                    "A retificação reabre o mês no eSocial, troca a remuneração pela nova e fecha o mês de novo. O novo fechamento gera a DCTFWeb retificadora e pede ao eSocial a transmissão dela; depois, gere o DARF com o valor novo no passo seguinte.",
                    "Se o pagamento do pró-labore mudou, ajuste também no portal do eSocial.",
                  ]}
                />
              </p>
              {enviar(true, previaRetificacao)}
            </details>
          )}
        </div>
      )}

      {!podeAqui && (
        <p className="text-sm text-muted">
          {disponivel ? MENSAGENS_DO_ESOCIAL.semConfig : MENSAGENS_DO_ESOCIAL.indisponivel}{" "}
          {disponivel && (
            <Link href="/esocial" className="font-medium underline underline-offset-2">
              Configurar o eSocial
            </Link>
          )}
        </p>
      )}

      <details className="group" open={!podeAqui || s.portal}>
        <summary className="cursor-pointer text-sm font-medium">Prefere lançar no portal do eSocial?</summary>
        <div className="pt-3">
          <FacaNoPortal
            funcao="esocial"
            motivo="Você mesmo lança no portal do eSocial; os valores estão acima."
            explicacao="Para quem não quer ou não pode assinar aqui: você faz no portal do eSocial com os valores que a plataforma calculou e marca aqui quando terminar (para o aviso de prazo parar)."
            rodape={
              s.portal ? (
                <BotaoDeAcao acao={acoes.marcarPortal} campos={{ ...campos, feito: "nao" }} rotulo="Desfazer: ainda não lancei" pendente="Desfazendo…" leve />
              ) : (
                !s.concluido && !s.emAndamento && <BotaoDeAcao acao={acoes.marcarPortal} campos={{ ...campos, feito: "sim" }} rotulo="Já lancei no portal" pendente="Marcando…" leve />
              )
            }
          />
        </div>
      </details>
      {meses && meses.length > 0 && <MesesNoEsocial meses={meses} atual={s.mes} />}
    </Passo>
  );
}
