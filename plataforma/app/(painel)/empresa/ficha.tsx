import type { ReactNode } from "react";
import { enderecoEmLinha, type DadosCnpj, type Opcao } from "@contabilizadev/nucleo/brasilapi/cnpj";
import { type AtividadeDiagnosticada, type Diagnostico, type Nota } from "@contabilizadev/nucleo/diagnostico";
import { dataBr, formatarCnae, formatarNatureza } from "@contabilizadev/nucleo/formato";
import { Explicacao, ExplicacaoDoTermo } from "@/app/explicacao";
import { Cartao, Secao, rotulo } from "@/app/ui";
import { Tabela } from "@/app/tabela";
import { formatarCnpj } from "@/lib/empresas/cnpj";
import { porcentagem, type Termo } from "@/lib/empresas/glossario";
import { LIMITE_FATOR_R } from "@contabilizadev/nucleo/simples";

// Dados da Receita e diagnóstico da empresa cadastrada (página Empresa). O que cada dado é fica no tooltip (ⓘ).

const data = (d: string | null) => (d ? dataBr(d) : "—");

const TRIBUTACAO: Record<AtividadeDiagnosticada["tributacao"], string> = {
  "anexo-fixo": "Anexo III",
  "fator-r": "Anexo III ou V (Fator R)",
  "nao-atendido": "Ainda não atendida",
};

// Rótulo do tooltip de cada atividade: pergunta específica, para não repetir o mesmo rótulo na tela.
export function perguntaDaAtividade(a: Pick<AtividadeDiagnosticada, "cnae" | "tributacao">): string {
  const cnae = formatarCnae(a.cnae);
  if (a.tributacao === "nao-atendido") return `Por que ${cnae} não é atendida?`;
  return a.tributacao === "fator-r" ? `Por que ${cnae} fica no Anexo III ou V?` : `Por que ${cnae} fica sempre no Anexo III?`;
}

// Texto do tooltip de cada atividade: a regra em linguagem simples e a base legal.
export function explicarAtividade(a: Pick<AtividadeDiagnosticada, "tributacao" | "fundamento">): string {
  const limite = porcentagem(LIMITE_FATOR_R);
  if (a.tributacao === "nao-atendido") return a.fundamento;
  const regra =
    a.tributacao === "fator-r"
      ? `Depende do Fator R: fica no Anexo III se a folha for de ${limite} da receita ou mais; abaixo disso, no Anexo V.`
      : "Esta atividade fica no Anexo III, sem depender do Fator R.";
  return `${regra} Base legal: ${a.fundamento}.`;
}

function opcao(o: Opcao, nome: string): string {
  if (o.optante === null) return "Não informado pela Receita";
  if (o.optante) return o.dataOpcao ? `Optante desde ${dataBr(o.dataOpcao)}` : "Optante";
  return o.dataExclusao ? `Não optante (excluída em ${dataBr(o.dataExclusao)})` : `Não optante do ${nome}`;
}

function Campo({ nome, termo, children }: { nome: string; termo?: Termo; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className={`flex items-center gap-1 ${rotulo}`}>
        {nome}
        {termo && <ExplicacaoDoTermo termo={termo} />}
      </dt>
      <dd className="text-sm font-medium break-words">{children}</dd>
    </div>
  );
}

// Motivos e avisos do diagnóstico: a versão curta na tela e o texto completo no tooltip de cada um. Usada aqui e no
// assistente de cadastro (etapa Diagnóstico).
export function ListaDeNotas({ notas, aviso, className = "" }: { notas: Nota[]; aviso?: boolean; className?: string }) {
  return (
    <ul className={`flex flex-col gap-1 text-sm ${aviso ? "" : "list-disc pl-5"} ${className}`}>
      {notas.map((n) => (
        <li key={n.detalhe}>
          {aviso && <span className="font-medium text-warn">Atenção: </span>}
          {n.curto} <Explicacao rotulo={n.pergunta} texto={n.detalhe} />
        </li>
      ))}
    </ul>
  );
}

// Resumo do diagnóstico: anexo e Fator R, ou por que ainda não atendemos.
export function CartaoDiagnostico({ diagnostico }: { diagnostico: Diagnostico }) {
  const d = diagnostico;
  return (
    <Cartao className={`flex flex-col gap-4 px-5 py-5 ${d.atendido ? "" : "border-warn/40 bg-warn-soft"}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`inline-flex h-7 items-center rounded-full px-3 text-xs font-semibold ${d.atendido ? "bg-accent text-on-accent" : "bg-warn text-bg"}`}
        >
          {d.atendido ? "Atendemos sua empresa" : "Ainda não atendemos"}
        </span>
        {d.anexo && (
          <span className="text-sm">
            Anexo <b className="font-semibold">{d.anexo}</b>
            {d.dependeFatorR ? " — depende do Fator R" : " — fixo, sem Fator R"}{" "}
            <ExplicacaoDoTermo termo={d.dependeFatorR ? "fatorR" : "anexoFixo"} />
          </span>
        )}
      </div>

      {!d.atendido && (
        <div className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-warn">Motivo{d.impedimentos.length > 1 ? "s" : ""}:</span>
          <ListaDeNotas notas={d.impedimentos} />
        </div>
      )}

      {d.observacoes.length > 0 && <ListaDeNotas notas={d.observacoes} aviso />}
    </Cartao>
  );
}

export function FichaReceita({ dados, diagnostico, consultadaEm }: { dados: DadosCnpj; diagnostico: Diagnostico; consultadaEm: string | Date }) {
  const quando = new Date(consultadaEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
  const natureza = dados.naturezaJuridica;
  return (
    <>
      <Secao titulo="Diagnóstico">
        <CartaoDiagnostico diagnostico={diagnostico} />
      </Secao>

      <Secao titulo="Dados na Receita Federal" explicacao={<ExplicacaoDoTermo termo="dadosErrados" />}>
        <Cartao className="px-5 py-5">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <Campo nome="Razão social" termo="razaoSocial">{dados.razaoSocial}</Campo>
            <Campo nome="Nome fantasia" termo="nomeFantasia">{dados.nomeFantasia ?? "—"}</Campo>
            <Campo nome="CNPJ">
              <span className="tabular-nums">{formatarCnpj(dados.cnpj)}</span>
            </Campo>
            <Campo nome="Situação cadastral" termo="situacao">
              <span className={dados.situacaoCadastral === "ATIVA" ? "" : "text-bad"}>{dados.situacaoCadastral}</span>
              {dados.dataSituacaoCadastral && <span className="font-normal text-muted"> desde {data(dados.dataSituacaoCadastral)}</span>}
            </Campo>
            <Campo nome="Natureza jurídica" termo="natureza">
              {natureza.descricao || "—"}
              {natureza.codigo && <span className="font-normal text-muted"> ({formatarNatureza(natureza.codigo)})</span>}
            </Campo>
            <Campo nome="Início da atividade" termo="abertura">{data(dados.dataInicioAtividade)}</Campo>
            <Campo nome="Simples Nacional" termo="simples">{opcao(dados.simples, "Simples")}</Campo>
            <Campo nome="MEI (SIMEI)" termo="mei">{opcao(dados.mei, "SIMEI")}</Campo>
            <Campo nome="Endereço" termo="endereco">{enderecoEmLinha(dados.endereco, dados.municipio, dados.uf) ?? "—"}</Campo>
          </dl>
        </Cartao>
      </Secao>

      <Secao titulo="Atividades (CNAE)" explicacao={<ExplicacaoDoTermo termo="cnaeEAnexo" />}>
        <Tabela
          rotulo="Atividades da empresa"
          colunas={[
            { chave: "descricao", titulo: "Atividade", principal: true },
            { chave: "cnae", titulo: "CNAE", classe: "whitespace-nowrap tabular-nums" },
            { chave: "tipo", titulo: "Tipo" },
            { chave: "tributacao", titulo: "Tributação no Simples" },
          ]}
          linhas={diagnostico.atividades.map((a) => ({
            chave: a.cnae,
            destaque: a.principal,
            celulas: {
              descricao: a.descricao || "—",
              cnae: formatarCnae(a.cnae),
              tipo: a.principal ? "Principal" : "Secundária",
              tributacao: (
                <span className={a.anexo ? "" : "font-medium text-warn"}>
                  {TRIBUTACAO[a.tributacao]}{" "}
                  <Explicacao rotulo={perguntaDaAtividade(a)} texto={explicarAtividade(a)} />
                </span>
              ),
            },
          }))}
        />
      </Secao>

      <Secao titulo="Sócios e administradores" explicacao={<ExplicacaoDoTermo termo="socios" />}>
        <Tabela
          rotulo="Quadro de sócios"
          vazio="A Receita não informa sócios para este CNPJ."
          colunas={[
            { chave: "nome", titulo: "Nome", principal: true },
            { chave: "qualificacao", titulo: "Qualificação" },
            { chave: "desde", titulo: "Desde", classe: "tabular-nums" },
          ]}
          linhas={dados.socios.map((s, i) => ({
            chave: `${s.nome}-${i}`,
            celulas: { nome: s.nome, qualificacao: s.qualificacao || "—", desde: data(s.dataEntrada) },
          }))}
        />
      </Secao>

      <p className="text-xs text-muted">Consultado na Receita Federal em {quando}.</p>
    </>
  );
}
