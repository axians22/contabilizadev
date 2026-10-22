import Link from "next/link";
import type { ReactNode } from "react";
import { enderecoEmLinha, type DadosCnpj } from "@contabilizadev/nucleo/brasilapi/cnpj";
import { opcaoVigente, type AtividadeDiagnosticada, type Diagnostico } from "@contabilizadev/nucleo/diagnostico";
import { dataBr, formatarCnae, formatarNatureza } from "@contabilizadev/nucleo/formato";
import { botaoLink, botaoPrimario, Campo, rotulo } from "@/app/ui";
import { Explicacao, ExplicacaoDoTermo } from "@/app/explicacao";
import { explicarAtividade, ListaDeNotas, perguntaDaAtividade } from "@/app/(painel)/empresa/ficha";
import { aguardaComprovacao, diaDaConsulta, exemploFatorR, explicarNatureza, explicarSituacao, orientacoes, resumoSimples, type Explicacao as Situacao, type PreviaDoAssistente } from "@/lib/empresas/assistente";
import { QSA_INDISPONIVEL } from "@/lib/empresas/qsa";
import { formatarCnpj, validarCnpj } from "@/lib/empresas/cnpj";
import type { Termo } from "@/lib/empresas/glossario";
import { porcentagem } from "@/lib/empresas/glossario";
import { LIMITE_FATOR_R } from "@contabilizadev/nucleo/simples";

// Conteúdo de cada etapa do assistente de cadastro. Sem estado: quem guarda o que foi preenchido é o assistente.
// Regra de tela: cada etapa mostra uma frase curta e os dados/ação; toda explicação vai para o tooltip (<Explicacao>).
// Só o que impede o cadastro (motivo e o que fazer) fica visível, curto, com os detalhes no tooltip.

const LIMITE = porcentagem(LIMITE_FATOR_R); // "28%"

const Frase = ({ children }: { children: ReactNode }) => <p className="max-w-2xl text-sm leading-relaxed">{children}</p>;

// Situação de um dado: em ordem, só um ✓ discreto com a frase curta; com problema, a frase curta em destaque e, no
// tooltip, a pergunta do caso (rótulo e título) com a resposta: por que impede e o que fazer. Neutro (a Receita não
// informa, mas não impede): só a frase.
function Estado({ e }: { e: Situacao }) {
  if (e.ok && e.neutro) return <span className="block text-sm text-muted">{e.curto}</span>;
  return (
    <span className={`block text-sm ${e.ok ? "text-muted" : "font-medium text-warn"}`}>
      <span aria-hidden="true" className="mr-1.5 font-semibold">
        {e.ok ? "✓" : "!"}
      </span>
      <span className="sr-only">{e.ok ? "Tudo certo: " : "Atenção: "}</span>
      {e.curto}
      {!e.ok && (
        <>
          {" "}
          <Explicacao rotulo={e.titulo} titulo={e.titulo} texto={e.texto} />
        </>
      )}
    </span>
  );
}

// Um dado da Receita, com o ⓘ do que é e por que importa ao lado do nome.
function Dado({ nome, termo, valor, children }: { nome: string; termo?: Termo; valor: ReactNode; children?: ReactNode }) {
  return (
    <li className="flex min-w-0 flex-col gap-1 border-t border-line pt-3 first:border-t-0 first:pt-0">
      <span className={`flex items-center gap-1 ${rotulo}`}>
        {nome}
        {termo && <ExplicacaoDoTermo termo={termo} />}
      </span>
      <div className="text-base font-semibold break-words">{valor}</div>
      {children}
    </li>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// 1. Pesquisar o CNPJ

export function EtapaCnpj({
  cnpj,
  aoDigitar,
  mudou,
  vencida,
  desligado,
  cadastrada,
}: {
  cnpj: string;
  aoDigitar: (v: string) => void;
  mudou: boolean;
  vencida?: boolean;
  desligado?: boolean;
  cadastrada?: boolean; // depois do cadastro o CNPJ fica só para leitura
}) {
  const completo = cnpj.replace(/[^0-9A-Z]/g, "").length === 14;
  const invalido = completo && validarCnpj(cnpj) === null;
  return (
    <>
      <Frase>Com o CNPJ, buscamos os dados públicos da empresa na Receita Federal.</Frase>
      <div className="flex flex-col gap-1.5">
        <Campo
          rotulo="CNPJ da empresa"
          id="cnpj"
          name="cnpj"
          value={cnpj}
          onChange={(e) => aoDigitar(e.target.value)}
          placeholder="00.000.000/0000-00"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={18}
          required
          disabled={desligado}
          readOnly={cadastrada}
          aria-invalid={invalido}
          aria-describedby="cnpj-ajuda"
          explicacao={
            <>
              <ExplicacaoDoTermo termo="cnpj" />
              <span className="ml-auto text-xs font-normal">
                <ExplicacaoDoTermo termo="ondeCnpj" gatilho="Onde encontrar?" />
              </span>
            </>
          }
        />
        <p id="cnpj-ajuda" className={`text-xs ${invalido ? "text-bad" : "text-muted"}`} aria-live="polite">
          {cadastrada
            ? "Empresa já cadastrada: os dados ficam só para conferir."
            : invalido
            ? "CNPJ inválido: os dígitos verificadores (os dois últimos) não batem. Confira o número."
            : mudou
              ? "Você mudou o CNPJ: ao continuar, consultamos o novo na Receita Federal."
              : vencida
                ? "A pesquisa anterior tem mais de 30 minutos: pesquise de novo para trazer os dados atualizados."
                : "Com ou sem pontuação; vale também o CNPJ com letras."}
        </p>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// 2. Conferir a empresa

const data = (d: string | null | undefined) => (d ? dataBr(d) : "Não informada");

// O resultado da conferência com o quadro de sócios: quem não está no quadro nem chega aqui (a pesquisa é recusada).
function QuadroDeSocios({ qsa }: { qsa: PreviaDoAssistente["qsa"] }) {
  if (qsa === "confere") return <Estado e={{ ok: true, curto: "Você está no quadro de sócios da empresa." }} />;
  if (qsa === "sem-qsa") return <Estado e={{ ok: false, curto: QSA_INDISPONIVEL.curto, titulo: QSA_INDISPONIVEL.titulo, texto: QSA_INDISPONIVEL.texto }} />;
  return null;
}

export function EtapaEmpresa({ dados, qsa }: { dados: DadosCnpj; qsa: PreviaDoAssistente["qsa"] }) {
  const natureza = dados.naturezaJuridica;
  const endereco = enderecoEmLinha(dados.endereco, dados.municipio, dados.uf);
  return (
    <>
      <p className="text-sm leading-relaxed">
        Confira se é a empresa certa. <ExplicacaoDoTermo termo="dadosErrados" />
      </p>
      <ul className="flex flex-col gap-3">
        <Dado nome="Razão social" termo="razaoSocial" valor={dados.razaoSocial} />
        <Dado nome="Nome fantasia" termo="nomeFantasia" valor={dados.nomeFantasia ?? "Não tem"} />
        <Dado nome="CNPJ" valor={<span className="tabular-nums">{formatarCnpj(dados.cnpj)}</span>} />
        <Dado
          nome="Situação cadastral"
          termo="situacao"
          valor={
            <>
              <span className={dados.situacaoCadastral === "ATIVA" ? "" : "text-bad"}>{dados.situacaoCadastral}</span>
              {dados.dataSituacaoCadastral && <span className="text-sm font-normal text-muted"> desde {dataBr(dados.dataSituacaoCadastral)}</span>}
            </>
          }
        >
          <Estado e={explicarSituacao(dados.situacaoCadastral)} />
        </Dado>
        <Dado
          nome="Natureza jurídica"
          termo="natureza"
          valor={
            <>
              {natureza.descricao || "Não informada"}
              {natureza.codigo && <span className="text-sm font-normal text-muted"> (código {formatarNatureza(natureza.codigo)})</span>}
            </>
          }
        >
          <Estado e={explicarNatureza(natureza.codigo)} />
        </Dado>
        <Dado nome="Endereço" termo="endereco" valor={endereco ?? "Não informado"} />
        <Dado nome="Data de abertura" termo="abertura" valor={data(dados.dataInicioAtividade)} />
        {dados.socios.length === 0 && qsa === "sem-qsa" && (
          <Dado nome="Sócios e administradores" termo="socios" valor="Não publicado pela Receita Federal">
            <QuadroDeSocios qsa={qsa} />
          </Dado>
        )}
        {dados.socios.length > 0 && (
          <Dado
            nome="Sócios e administradores"
            termo="socios"
            valor={
              <ul className="flex flex-col gap-0.5 text-sm font-medium">
                {dados.socios.map((s, i) => (
                  <li key={`${s.nome}-${i}`}>
                    {s.nome}
                    {s.qualificacao && <span className="font-normal text-muted"> · {s.qualificacao}</span>}
                  </li>
                ))}
              </ul>
            }
          >
            <QuadroDeSocios qsa={qsa} />
            <span className="text-sm text-muted">
              <ExplicacaoDoTermo termo="proLabore" gatilho="Pró-labore e Fator R" rotulo="Pró-labore e Fator R: o que é o pró-labore?" />
            </span>
          </Dado>
        )}
      </ul>
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// 3. Atividades (CNAEs)

const TRIBUTACAO: Record<AtividadeDiagnosticada["tributacao"], string> = {
  "fator-r": "Anexo III ou V",
  "anexo-fixo": "Sempre Anexo III",
  "nao-atendido": "Ainda não atendemos: fora das atividades de TI",
};

// Descrição oficial do CNAE pode passar de 100 caracteres: na linha vai até ~70, cortada na palavra; a inteira fica
// no tooltip da atividade.
const DESCRICAO_NA_LINHA = 70;
function descricaoCurta(descricao: string): string {
  if (descricao.length <= DESCRICAO_NA_LINHA) return descricao;
  const corte = descricao.slice(0, DESCRICAO_NA_LINHA + 1).replace(/[\s,;]+\S*$/, "");
  return `${corte}…`;
}

function ListaDeAtividades({ titulo, atividades }: { titulo: string; atividades: AtividadeDiagnosticada[] }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">{titulo}</h3>
      <ul className="flex flex-col gap-2">
        {atividades.map((a) => {
          return (
            <li key={a.cnae} className={`flex flex-col gap-1 rounded-xl border px-4 py-3 ${a.anexo ? "border-line" : "border-warn/40 bg-warn-soft"}`}>
              <span className="text-sm font-medium">
                <span className="tabular-nums">{formatarCnae(a.cnae)}</span> · {descricaoCurta(a.descricao || "Sem descrição")}
              </span>
              {/* Atividade não atendida impede o cadastro: o motivo fica na tela, curto; o fundamento, no tooltip dela. */}
              <span className={`text-sm ${a.anexo ? "text-muted" : "font-medium text-warn"}`}>
                {TRIBUTACAO[a.tributacao]}.{" "}
                <Explicacao
                  rotulo={perguntaDaAtividade(a)}
                  titulo={a.descricao.length > DESCRICAO_NA_LINHA ? a.descricao : undefined}
                  texto={explicarAtividade(a)}
                />
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function EtapaAtividades({ diagnostico }: { diagnostico: Diagnostico }) {
  const principal = diagnostico.atividades.filter((a) => a.principal);
  const secundarias = diagnostico.atividades.filter((a) => !a.principal);
  return (
    <>
      <p className="text-sm leading-relaxed">
        O código de cada atividade, o <ExplicacaoDoTermo termo="cnae" gatilho="CNAE" />, define o{" "}
        <ExplicacaoDoTermo termo="anexo" gatilho="anexo do Simples" />. <ExplicacaoDoTermo termo="cnaeEAnexo" />
      </p>
      <ListaDeAtividades titulo="Atividade principal" atividades={principal} />
      {secundarias.length > 0 ? (
        <ListaDeAtividades titulo="Atividades secundárias" atividades={secundarias} />
      ) : (
        <p className="text-sm text-muted">A empresa não tem atividades secundárias.</p>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// 4. Simples Nacional

export function EtapaSimples({ previa }: { previa: PreviaDoAssistente }) {
  const hoje = diaDaConsulta(previa.consultadaEm);
  const { simples, mei } = resumoSimples(previa.dados, hoje);
  const noSimples = opcaoVigente(previa.dados.simples, hoje);
  const ehMei = opcaoVigente(previa.dados.mei, hoje);
  const simNao = (x: boolean | null) => (x === null ? "Não informado" : x ? "Sim" : "Não");
  return (
    <>
      <p className="text-sm leading-relaxed">
        Atendemos empresas do Simples Nacional que não são MEI. <ExplicacaoDoTermo termo="naPratica" />
      </p>
      <ul className="flex flex-col gap-3">
        <Dado nome="Simples Nacional" termo="simples" valor={simNao(noSimples)}>
          <Estado e={simples} />
        </Dado>
        <Dado nome="MEI" termo="mei" valor={simNao(ehMei)}>
          <Estado e={mei} />
        </Dado>
      </ul>
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// 5. Diagnóstico

export function EtapaDiagnostico({ previa, cadastrada = false }: { previa: PreviaDoAssistente; cadastrada?: boolean }) {
  const d = previa.diagnostico;
  if (!d.atendido) {
    return (
      <>
        {/* O título da etapa já diz "Ainda não atendemos esta empresa": sem selo repetindo. */}
        <div className="flex flex-col gap-1.5 text-sm">
          <h3 className="flex items-center gap-1 font-semibold">
            Motivo{d.impedimentos.length > 1 ? "s" : ""}
            <Explicacao
              rotulo="Quem atendemos nesta versão?"
              texto="Atendemos empresas de TI do Simples Nacional que não são MEI, com CNPJ ativo e de um dos tipos de empresa atendidos."
            />
          </h3>
          <ListaDeNotas notas={d.impedimentos} className="leading-relaxed" />
        </div>
        <Frase>Não vamos cadastrar a empresa agora. Na próxima etapa, mostramos o que fazer.</Frase>
      </>
    );
  }
  const ex = exemploFatorR();
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <p className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-on-accent">Atendemos sua empresa</p>
        {/* Só o anexo na tela: a regra do Fator R fica no tooltip dele, e o exemplo, só com os números, no "Ver exemplo". */}
        {d.dependeFatorR ? (
          <p className="text-sm">
            Anexo <b className="font-semibold">{d.anexo}</b>, conforme o Fator R <ExplicacaoDoTermo termo="fatorR" />
            <span aria-hidden="true" className="mx-1.5 text-muted">
              ·
            </span>
            <Explicacao rotulo="Ver exemplo: como fica o Fator R com números?" gatilho="Ver exemplo" titulo="Exemplo com números redondos" lista={ex.textos} ordenada />
          </p>
        ) : (
          <p className="text-sm">
            Anexo <b className="font-semibold">{d.anexo}</b>, fixo (sem Fator R) <ExplicacaoDoTermo termo="anexoFixo" />
          </p>
        )}
      </div>
      {d.observacoes.length > 0 && <ListaDeNotas notas={d.observacoes} aviso />}
      <Frase>
        {!aguardaComprovacao(previa) ? (
          cadastrada ? (
            <>
              A <b className="font-semibold">{previa.dados.razaoSocial}</b> já está cadastrada e você é o dono dela.
            </>
          ) : (
            <>
              Ao confirmar, cadastramos a <b className="font-semibold">{previa.dados.razaoSocial}</b> e você fica como dono dela.
            </>
          )
        ) : cadastrada ? (
          <>
            A <b className="font-semibold">{previa.dados.razaoSocial}</b> já está cadastrada e aguarda a comprovação pelo termo.
          </>
        ) : (
          <>
            Ao confirmar, cadastramos a <b className="font-semibold">{previa.dados.razaoSocial}</b>; ela fica aguardando a comprovação pelo termo de autorização.
          </>
        )}
      </Frase>
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// 6. Empresa cadastrada (ou, se ainda não atendemos, o que fazer)

export function EtapaProximos({ previa, cadastrada, aoRecomecar }: { previa: PreviaDoAssistente; cadastrada: boolean; aoRecomecar: () => void }) {
  const painel = (
    <Link href="/" className={`${botaoLink} h-10 justify-center`}>
      Ir para o painel
    </Link>
  );
  if (!cadastrada) {
    const lista = orientacoes(previa.dados, previa.diagnostico, diaDaConsulta(previa.consultadaEm));
    return (
      <>
        <Frase>
          Não cadastramos a <b className="font-semibold">{previa.dados.razaoSocial}</b>. Veja o que fazer e pesquise de novo quando resolver:
        </Frase>
        <ul className="flex flex-col gap-2">
          {lista.map((o) => (
            <li key={o.titulo} className="flex flex-col gap-0.5 rounded-xl border border-line px-4 py-3 text-sm leading-relaxed">
              <h3 className="flex items-center gap-1 font-semibold">
                {o.titulo}
                <Explicacao rotulo={o.pergunta} titulo={o.titulo} texto={o.texto} />
              </h3>
              <p className="text-muted">{o.curto}</p>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button type="button" onClick={aoRecomecar} className={`${botaoPrimario} justify-center`}>
            Pesquisar outro CNPJ
          </button>
          {painel}
        </div>
      </>
    );
  }
  const faz = [
    `Calcula o DAS todo mês, no anexo certo${previa.diagnostico.dependeFatorR ? " e com o Fator R refeito a cada mês" : ""}.`,
    ...(previa.diagnostico.dependeFatorR ? [`Avisa quando o Fator R chegar perto de ${LIMITE}, com a sugestão de pró-labore.`] : []),
    "Mostra as guias, os prazos e os avisos da Receita Federal no painel.",
  ];
  if (aguardaComprovacao(previa)) {
    return (
      <>
        <p className="text-sm leading-relaxed">
          A <b className="font-semibold">{previa.dados.razaoSocial}</b> está cadastrada e aguarda comprovação.{" "}
          <Explicacao
            rotulo="Por que a empresa aguarda comprovação?"
            texto={[
              "Para ninguém ver os dados de uma empresa que não é sua, o conteúdo só abre depois que o termo de autorização é assinado com o e-CNPJ A1 da empresa, emitido em nome do seu CPF.",
              "Até lá, nenhum dado da empresa aparece e nenhuma consulta é feita em nome dela.",
            ]}
          />
        </p>
        <p className="text-sm leading-relaxed">
          A seguir, assine o termo para comprovar e liberar a plataforma. <ExplicacaoDoTermo termo="termo" />
        </p>
      </>
    );
  }
  return (
    <>
      <p className="text-sm leading-relaxed">
        Pronto! A <b className="font-semibold">{previa.dados.razaoSocial}</b> está cadastrada e você é o dono dela.{" "}
        <Explicacao rotulo="O que a plataforma faz a partir de agora?" titulo="A partir de agora, a plataforma:" lista={faz} />
      </p>
      <p className="text-sm leading-relaxed">
        A seguir, a autorização (opcional): com ela, declarações e guias são feitas aqui mesmo. <ExplicacaoDoTermo termo="termo" />
      </p>
    </>
  );
}
