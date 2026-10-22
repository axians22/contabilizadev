"use client";

import Link from "next/link";
import { useEffect, useReducer, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { Explicacao } from "@/app/explicacao";
import { botaoLink, botaoPrimario, Cartao } from "@/app/ui";
import {
  acaoPrincipal,
  ESTADO_INICIAL,
  etapasDo,
  indiceDaEtapa,
  podeVoltar,
  precisaRepesquisar,
  previaVencida,
  progresso,
  reduzir,
  tituloDaEtapa,
  vistaDaAutorizacao,
  type Autorizacao,
  type EstadoAssistente,
} from "@/lib/empresas/assistente";
import { mascararCnpj, normalizarCnpj, validarCnpj } from "@/lib/empresas/cnpj";
import { AUTORIZAR_DEPOIS } from "@/lib/termo/mensagens";
import type { EstadoEnvio } from "../../autorizacao/acoes";
import type { ErroDaTela, RespostaCadastro, RespostaConsulta } from "./acoes";
import { EtapaAutorizacao } from "./etapa-autorizacao";
import { EtapaAtividades, EtapaCnpj, EtapaDiagnostico, EtapaEmpresa, EtapaProximos, EtapaSimples } from "./etapas";

// Assistente de cadastro: uma etapa por tela, com a trilha das etapas, Voltar e Continuar. Explicações só no tooltip. O que foi preenchido fica no
// estado (lib/empresas/assistente.ts), então voltar não perde nada. O foco vai para o título a cada troca de etapa,
// para quem usa teclado ou leitor de tela saber onde está. O cadastro acontece no passo 5; o 7 é a autorização, com o
// mesmo fluxo da página Autorização (AssinarTermo e as ações de lá), e é opcional ("Fazer depois").

const ROTULO_ACAO = { consultar: "Pesquisar CNPJ", continuar: "Continuar", cadastrar: "Confirmar e cadastrar" } as const;
const PESQUISADA_DE_NOVO = "Buscamos os dados de novo na Receita Federal (a pesquisa tinha mais de 30 minutos). Confira e confirme.";
const ROTULO_OCUPADO = { consultar: "Pesquisando na Receita Federal…", continuar: "Continuar", cadastrar: "Cadastrando…" } as const;

// Trilha: "Passo N de 7 · Nome da etapa" e, embaixo, as etapas como bolinhas numeradas ligadas por uma linha
// (concluídas em verde, a atual destacada). Os nomes ficam só no texto de cima e para o leitor de tela (sr-only), que
// continua achando o aria-current.
function Trilha({ estado }: { estado: EstadoAssistente }) {
  const etapas = etapasDo(estado);
  const atual = indiceDaEtapa(estado.etapa);
  return (
    <nav aria-label="Etapas do cadastro" className="flex flex-col gap-3">
      <p className="text-xs text-muted">
        <span className="font-medium text-fg">{progresso(estado)}</span> · {etapas[atual].nome}
      </p>
      <ol className="flex items-center">
        {etapas.map((e, i) => (
          <li key={e.id} aria-current={i === atual ? "step" : undefined} className={`flex items-center ${i > 0 ? "flex-1" : ""}`}>
            {i > 0 && (
              <span aria-hidden="true" className={`mx-1 h-0.5 flex-1 rounded-full transition-colors duration-300 motion-reduce:transition-none ${i <= atual ? "bg-accent-ink" : "bg-line"}`} />
            )}
            <span
              aria-hidden="true"
              className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-medium transition-colors duration-300 motion-reduce:transition-none ${
                i < atual ? "bg-accent-ink text-bg" : i === atual ? "border-2 border-accent-ink text-fg" : "border border-line text-muted"
              }`}
            >
              {i + 1}
            </span>
            <span className="sr-only">
              {i + 1}. {e.nome}
              {i < atual && " (concluída)"}
            </span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function Assistente({
  consultar,
  cadastrar,
  preparar,
  enviar,
  inicial = ESTADO_INICIAL,
}: {
  consultar: (cnpj: string) => Promise<RespostaConsulta>;
  cadastrar: (previa: string) => Promise<RespostaCadastro>;
  preparar: (empresaId: string) => Promise<Autorizacao>; // prepararAutorizacaoAcao (página Autorização)
  enviar: (empresaId: string, xml: string) => Promise<EstadoEnvio>; // enviarTermoAcao (página Autorização)
  inicial?: EstadoAssistente;
}) {
  const [estado, despachar] = useReducer(reduzir, inicial);
  const [erro, setErro] = useState<ErroDaTela | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  // O termo está sendo enviado no passo 7: Voltar e "Fazer depois" ficam desligados até a resposta chegar.
  const [enviandoTermo, setEnviandoTermo] = useState(false);
  const titulo = useRef<HTMLHeadingElement>(null);
  const etapaAnterior = useRef(estado.etapa);

  // Foco no título quando a etapa muda (não na primeira tela, para não pular o resto da página). Compara com a etapa
  // anterior em vez de "pular a primeira vez": o modo estrito do React roda o efeito duas vezes ao montar.
  useEffect(() => {
    if (etapaAnterior.current === estado.etapa) return;
    etapaAnterior.current = estado.etapa;
    titulo.current?.focus();
  }, [estado.etapa]);

  const acao = acaoPrincipal(estado);
  const cnpjInvalido = estado.etapa === "cnpj" && acao === "consultar" && validarCnpj(estado.cnpj) === null;

  // Pesquisa o CNPJ. No diagnóstico (prévia vencida), troca a prévia ali mesmo e avisa que os dados foram atualizados.
  async function pesquisar(cnpj: string, refazendo: boolean) {
    const r = await consultar(cnpj);
    if ("erro" in r) return setErro(r);
    // A idade da prévia conta a partir de agora, no relógio do navegador (o do servidor pode estar diferente).
    despachar({ tipo: "consultou", previa: r.previa, agora: Date.now() });
    if (refazendo) setAviso(PESQUISADA_DE_NOVO);
  }

  function aoEnviar(evento: FormEvent) {
    evento.preventDefault();
    // A ação é calculada de novo no clique: a tela pode ter ficado aberta e a prévia vencido desde que foi desenhada.
    const agora = Date.now();
    const acaoAgora = acaoPrincipal(estado, agora);
    if (ocupado || !acaoAgora) return;
    setErro(null);
    setAviso(null);
    if (acaoAgora === "continuar") return despachar({ tipo: "continuar", agora });
    const cnpj = estado.cnpj;
    if (acaoAgora === "consultar") return iniciar(() => pesquisar(cnpj, false));
    // Prévia vencida no diagnóstico: o servidor recusaria; pesquisa de novo aqui mesmo e pede a confirmação.
    if (precisaRepesquisar(estado, agora)) return iniciar(() => pesquisar(cnpj, true));
    const token = estado.previa?.token ?? "";
    iniciar(async () => {
      const r = await cadastrar(token);
      if (!("erro" in r)) {
        // Já prepara o passo 7 (só banco). Se falhar, a empresa está cadastrada: o passo 7 diz para autorizar depois.
        let autorizacao: Autorizacao;
        try {
          autorizacao = await preparar(r.empresaId);
        } catch {
          autorizacao = { tipo: "indisponivel", mensagem: AUTORIZAR_DEPOIS };
        }
        despachar({ tipo: "cadastrou", empresaId: r.empresaId });
        despachar({ tipo: "preparou", autorizacao });
        return;
      }
      // O servidor recusou a prévia (relógio diferente, por exemplo): pesquisa de novo em vez de deixar o cliente preso.
      if (r.expirou) return pesquisar(cnpj, true);
      setErro(r);
    });
  }

  function voltar() {
    setErro(null);
    setAviso(null);
    despachar({ tipo: "voltar" });
  }

  const p = estado.previa;
  let conteudo;
  switch (estado.etapa) {
    case "cnpj":
      conteudo = (
        <EtapaCnpj
          cnpj={estado.cnpj}
          aoDigitar={(v) => despachar({ tipo: "digitar", cnpj: mascararCnpj(v) })}
          mudou={!!p && normalizarCnpj(estado.cnpj) !== p.dados.cnpj}
          vencida={!!p && previaVencida(estado.recebidaEm)}
          desligado={ocupado}
          cadastrada={!!estado.empresaId}
        />
      );
      break;
    case "empresa":
      conteudo = p && <EtapaEmpresa dados={p.dados} qsa={p.qsa} />;
      break;
    case "atividades":
      conteudo = p && <EtapaAtividades diagnostico={p.diagnostico} />;
      break;
    case "simples":
      conteudo = p && <EtapaSimples previa={p} />;
      break;
    case "diagnostico":
      conteudo = p && <EtapaDiagnostico previa={p} cadastrada={!!estado.empresaId} />;
      break;
    case "proximos":
      conteudo = p && <EtapaProximos previa={p} cadastrada={!!estado.empresaId} aoRecomecar={() => despachar({ tipo: "recomecar" })} />;
      break;
    case "autorizacao":
      conteudo = <EtapaAutorizacao estado={estado} enviar={enviar} aoConcluir={(validaAte) => despachar({ tipo: "autorizou", validaAte })} aoMudarEnvio={setEnviandoTermo} />;
      break;
  }

  const botaoVoltar = podeVoltar(estado) ? (
    <button
      type="button"
      onClick={voltar}
      disabled={ocupado || enviandoTermo}
      className="inline-flex h-10 cursor-pointer items-center justify-center rounded-full px-4 text-sm font-medium text-muted transition-colors hover:bg-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink disabled:opacity-50"
    >
      ← Voltar
    </button>
  ) : (
    <span className="hidden sm:block" />
  );
  const rodape = (botoes: ReactNode) => <div className="flex flex-col-reverse gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">{botoes}</div>;

  // Passo 7: a assinatura tem o próprio formulário (certificado e senha), então a etapa não fica dentro do <form> do
  // assistente. Enquanto não assinou, "Fazer depois" leva ao painel (a empresa fica no modo guiado); depois, ou se não
  // há o que assinar, "Ir para o painel".
  if (estado.etapa === "autorizacao") {
    const pendente = ["carregando", "assinar"].includes(vistaDaAutorizacao(estado));
    return (
      <div className="flex max-w-3xl flex-col gap-5">
        <Trilha estado={estado} />
        <section aria-labelledby="titulo-etapa">
          <Cartao className="flex flex-col gap-5 px-5 py-6 sm:px-7">
            <h2 id="titulo-etapa" ref={titulo} tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none">
              {tituloDaEtapa(estado)}
            </h2>
            {conteudo}
            {rodape(
              <>
                {botaoVoltar}
                {enviandoTermo ? (
                  <span aria-disabled="true" className={`${botaoLink} h-10 cursor-not-allowed justify-center opacity-50`}>
                    Fazer depois
                  </span>
                ) : (
                  <Link href="/" className={pendente ? `${botaoLink} h-10 justify-center` : `${botaoPrimario} justify-center`}>
                    {pendente ? "Fazer depois" : "Ir para o painel"}
                  </Link>
                )}
              </>,
            )}
          </Cartao>
        </section>
      </div>
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <Trilha estado={estado} />
      <form onSubmit={aoEnviar} noValidate aria-labelledby="titulo-etapa">
        <Cartao className="flex flex-col gap-5 px-5 py-6 sm:px-7">
          <h2 id="titulo-etapa" ref={titulo} tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none">
            {tituloDaEtapa(estado)}
          </h2>
          {conteudo}
          {precisaRepesquisar(estado) && !ocupado && (
            <p className="flex items-center gap-1 rounded-xl bg-raised px-4 py-3 text-sm">
              Esta pesquisa tem mais de 30 minutos: ao confirmar, pesquisamos de novo.
              <Explicacao
                rotulo="Por que pesquisar de novo?"
                texto="Por segurança, só cadastramos com dados recentes da Receita Federal. Ao clicar em Confirmar e cadastrar, pesquisamos de novo e você confere o diagnóstico atualizado antes de cadastrar."
              />
            </p>
          )}
          {aviso && (
            <p role="status" className="rounded-xl bg-raised px-4 py-3 text-sm">
              {aviso}
            </p>
          )}
          {erro && (
            <p role="alert" className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-warn-soft px-4 py-3 text-sm text-bad">
              <span>
                {erro.erro}
                {erro.explicacao && (
                  <>
                    {" "}
                    <Explicacao rotulo={erro.explicacao.titulo} titulo={erro.explicacao.titulo} texto={erro.explicacao.texto} />
                  </>
                )}
              </span>
              {erro.seusDados && (
                <Link href="/meus-dados" className="font-semibold underline underline-offset-2">
                  Preencher Seus dados
                </Link>
              )}
            </p>
          )}
          {(acao || podeVoltar(estado)) &&
            rodape(
              <>
                {botaoVoltar}
                {acao && (
                  <button type="submit" disabled={ocupado || cnpjInvalido} className={`${botaoPrimario} justify-center disabled:cursor-not-allowed disabled:opacity-50`}>
                    {ocupado
                      ? ROTULO_OCUPADO[precisaRepesquisar(estado) ? "consultar" : acao]
                      : estado.etapa === "diagnostico" && acao === "continuar" && !estado.empresaId
                        ? "Ver o que fazer"
                        : ROTULO_ACAO[acao]}
                  </button>
                )}
              </>,
            )}
        </Cartao>
      </form>
    </div>
  );
}
