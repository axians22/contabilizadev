"use client";

import { useActionState, useId, useRef, useState, useTransition, type ReactNode } from "react";
import { brl } from "@contabilizadev/nucleo/formato";
import { Assinador } from "@/app/assinador/assinador";
import { Explicacao } from "@/app/explicacao";
import { Botao, Campo, botaoPrimario } from "@/app/ui";
import type { Assinante } from "@/lib/assinador/assinador";
import type { EstadoDaAcao, PreparoDctf } from "./acoes";

type Acao = (anterior: EstadoDaAcao, dados: FormData) => Promise<EstadoDaAcao>;

function Situacao({ estado }: { estado: EstadoDaAcao }) {
  return (
    <span aria-live="polite" className={`text-sm ${estado?.erro ? "text-bad" : "text-accent-ink"}`}>
      {estado?.erro ?? estado?.ok ?? ""}
    </span>
  );
}

const Ocultos = ({ campos }: { campos: Record<string, string> }) => (
  <>
    {Object.entries(campos).map(([nome, valor]) => (
      <input key={nome} type="hidden" name={nome} value={valor} />
    ))}
  </>
);

// Um botão que chama uma ação (simular, gerar guia, conferir) e mostra o desfecho curto ao lado.
export function BotaoDeAcao({ acao, campos, rotulo, pendente: textoPendente, leve, children }: { acao: Acao; campos: Record<string, string>; rotulo: string; pendente: string; leve?: boolean; children?: ReactNode }) {
  const [estado, executar, pendente] = useActionState(acao, undefined);
  return (
    <form action={executar} className="flex flex-wrap items-end gap-3">
      <Ocultos campos={campos} />
      {children}
      <Botao leve={leve} disabled={pendente}>
        {pendente ? textoPendente : rotulo}
      </Botao>
      <Situacao estado={estado} />
    </form>
  );
}

const MOEDAS: [string, string][] = [
  ["BRL", "Real (R$)"],
  ["USD", "Dólar (US$)"],
  ["EUR", "Euro (€)"],
  ["GBP", "Libra (£)"],
  ["CAD", "Dólar canadense"],
  ["AUD", "Dólar australiano"],
  ["CHF", "Franco suíço"],
  ["JPY", "Iene"],
];

// Lançar a receita do mês (painel e passo 1 do Roteiro, como o cartão de lançar do ../fiscal): o valor que caiu no banco,
// a data, a moeda e a observação; em moeda estrangeira, o valor em reais é opcional (sem ele, a conversão é pela PTAX de
// compra do dia). Com `liberadoEm` (mês ainda em andamento), os campos já aparecem, mas o envio fica bloqueado até o mês
// acabar: o botão desligado diz a data, e a ação no servidor também recusa.
export function LancarReceita({ acao, empresaId, pa, hoje, liberadoEm }: { acao: Acao; empresaId: string; pa: string; hoje: string; liberadoEm?: string }) {
  const [estado, executar, pendente] = useActionState(acao, undefined);
  const [moeda, setMoeda] = useState("BRL");
  const bloqueado = Boolean(liberadoEm);
  return (
    <form
      action={bloqueado ? undefined : executar}
      onSubmit={bloqueado ? (e) => e.preventDefault() : undefined}
      data-bloqueado={bloqueado || undefined}
      className="flex flex-wrap items-end gap-x-3.5 gap-y-3"
    >
      <Ocultos campos={{ empresaId, pa }} />
      <Campo rotulo={moeda === "BRL" ? "Valor que caiu no banco (R$)" : "Valor na moeda"} id="valor" name="valor" inputMode="decimal" placeholder="0,00" required />
      <Campo rotulo="Data em que caiu" id="recebidaEm" name="recebidaEm" type="date" min={`${pa}-01`} max={hoje} defaultValue={hoje} required />
      <label htmlFor="moeda" className="flex flex-col gap-1.5 text-sm font-medium text-muted">
        Moeda
        <select
          id="moeda"
          name="moeda"
          value={moeda}
          onChange={(e) => setMoeda(e.target.value)}
          className="h-10 rounded-xl border border-line bg-surface px-3 font-normal text-fg hover:border-muted"
        >
          {MOEDAS.map(([codigo, nome]) => (
            <option key={codigo} value={codigo}>
              {nome}
            </option>
          ))}
        </select>
      </label>
      {moeda !== "BRL" && (
        <Campo
          rotulo="Valor que caiu em reais (opcional)"
          id="valorBrl"
          name="valorBrl"
          inputMode="decimal"
          placeholder="pela PTAX"
          explicacao={
            <Explicacao
              rotulo="Qual valor em reais vale para o imposto?"
              texto={[
                "A receita do mês é o valor em reais que entrou na conta da empresa no Brasil pelo trabalho do mês.",
                "Se você não informar, convertemos pela PTAX de compra do Banco Central do dia em que o dinheiro caiu (ou do último dia útil antes). Com o valor do extrato do banco, o cálculo fica exato.",
              ]}
            />
          }
        />
      )}
      <Campo rotulo="Observação" id="observacao" name="observacao" maxLength={200} />
      {bloqueado ? (
        <button type="button" disabled className={`${botaoPrimario} cursor-not-allowed opacity-50 hover:brightness-100 active:scale-100`}>
          Lançar a partir de {liberadoEm}
        </button>
      ) : (
        <Botao disabled={pendente}>{pendente ? "Lançando…" : "Lançar"}</Botao>
      )}
      <Situacao estado={estado} />
    </form>
  );
}

// Pró-labore de um mês: o do mês apurado (passo 2) ou o do mês corrente (o que a sugestão do Fator R pede), cada um no
// seu formulário, para que ajustar um não altere o outro.
export function InformarProLabore({
  acao,
  empresaId,
  mes,
  valor,
  id = "prolabore",
  rotulo = "Pró-labore do mês (bruto)",
  pergunta = "Para que serve o pró-labore aqui?",
  explicacao = [
    "É a remuneração do sócio no mês, antes do INSS. Ele entra no Fator R (folha de salários) e define o INSS (11%, até o teto do INSS) que a DCTFWeb do mês deve cobrar.",
    "Sem pró-labore no mês, informe zero.",
  ],
}: {
  acao: Acao;
  empresaId: string;
  mes: string;
  valor: number | null;
  id?: string;
  rotulo?: string;
  pergunta?: string;
  explicacao?: string[];
}) {
  const [estado, executar, pendente] = useActionState(acao, undefined);
  return (
    <form action={executar} className="flex flex-wrap items-end gap-3">
      <Ocultos campos={{ empresaId, mes }} />
      <Campo
        rotulo={rotulo}
        id={id}
        name="valor"
        inputMode="decimal"
        placeholder="0,00"
        defaultValue={valor !== null ? valor.toFixed(2).replace(".", ",") : ""}
        required
        explicacao={<Explicacao rotulo={pergunta} texto={explicacao} />}
      />
      <Botao leve disabled={pendente}>
        {pendente ? "Salvando…" : "Salvar"}
      </Botao>
      <Situacao estado={estado} />
    </form>
  );
}

const DIALOGO =
  "w-[min(34rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-0 text-fg shadow-2xl backdrop:bg-black/50 open:flex open:flex-col";

// Confirmação explícita antes de qualquer envio à Receita: a caixa de diálogo com o resumo do que vai ser enviado e a
// caixa "Confirmo"; só então a ação é chamada (com os valores do resumo, que o servidor confere de novo).
export function ConfirmarEnvio({
  acao,
  campos,
  rotulo,
  titulo,
  resumo,
  confirmo,
  explicacao,
  perigo,
  pendente: textoPendente = "Enviando à Receita Federal…",
  confirmar = "Confirmar e enviar",
}: {
  acao: Acao;
  campos: Record<string, string>;
  rotulo: string;
  titulo: string;
  resumo: [string, string][];
  confirmo: string;
  explicacao: string[];
  perigo?: boolean;
  pendente?: string;
  confirmar?: string; // o botão que envia (ex.: "Abrir a mensagem")
}) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const idTitulo = `confirmar-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [estado, executar, pendente] = useActionState(async (anterior: EstadoDaAcao, dados: FormData) => {
    const r = await acao(anterior, dados);
    if (r?.ok) dialogo.current?.close();
    return r;
  }, undefined);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Botao type="button" leve={perigo} onClick={() => dialogo.current?.showModal()}>
        {rotulo}
      </Botao>
      <Situacao estado={estado} />
      <dialog ref={dialogo} className={DIALOGO} aria-labelledby={idTitulo}>
        <form action={executar} className="flex flex-col gap-4 px-5 py-5">
          <Ocultos campos={campos} />
          <h2 id={idTitulo} className="flex items-center gap-1 text-lg font-semibold tracking-tight">
            {titulo}
            <Explicacao rotulo={`O que acontece ao confirmar: ${titulo}?`} texto={explicacao} />
          </h2>
          <dl className="text-sm">
            {resumo.map(([nome, valor]) => (
              <div key={nome} className="flex flex-wrap justify-between gap-x-4 border-t border-line py-2">
                <dt className="text-muted">{nome}</dt>
                <dd className="font-medium tabular-nums">{valor}</dd>
              </div>
            ))}
          </dl>
          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" name="confirmo" value="sim" required className="mt-1 size-4" />
            <span>{confirmo}</span>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Botao disabled={pendente}>{pendente ? textoPendente : confirmar}</Botao>
            <Botao type="button" leve onClick={() => dialogo.current?.close()} disabled={pendente}>
              Cancelar
            </Botao>
          </div>
          <Situacao estado={estado} />
        </form>
      </dialog>
    </div>
  );
}

// DCTFWeb de cliente: assinada aqui, no navegador, com o e-CNPJ A1 da empresa, pelo assinador único (app/assinador:
// "Usar só agora" ou "Guardar neste navegador", o mesmo do termo de autorização). O servidor recebe só o certificado
// público, depois o valor assinado pela chave não exportável do WebCrypto. Antes de enviar, a confirmação com o resumo.
export function AssinarDctf({
  empresaId,
  cnpj,
  pa,
  resumo,
  preparar,
  transmitir,
}: {
  empresaId: string;
  cnpj: string;
  pa: string;
  resumo: [string, string][];
  preparar: (empresaId: string, pa: string, certificado: string) => Promise<PreparoDctf>;
  transmitir: (empresaId: string, pa: string, envio: { preparoId: string; assinatura: string; aPagar: number; confirmado: boolean }) => Promise<EstadoDaAcao>;
}) {
  const assinante = useRef<Assinante | null>(null);
  const dialogo = useRef<HTMLDialogElement>(null);
  const [preparo, setPreparo] = useState<Extract<PreparoDctf, { preparoId: string }> | null>(null);
  const [confirmado, setConfirmado] = useState(false);
  const [estado, setEstado] = useState<EstadoDaAcao>(undefined);
  const [enviando, iniciar] = useTransition();

  const descartar = () => {
    assinante.current = null;
    setPreparo(null);
    setConfirmado(false);
  };

  // Com o certificado em mãos (aberto agora ou guardado), o servidor prepara o texto a assinar e a confirmação abre.
  async function aoAssinante(a: Assinante) {
    setEstado(undefined);
    let p: PreparoDctf;
    try {
      p = await preparar(empresaId, pa, a.info.certificadoBase64);
    } catch {
      p = { erro: "Não foi possível falar com o servidor. Confira a conexão e tente de novo." };
    }
    if ("erro" in p) {
      descartar();
      return p.erro;
    }
    assinante.current = a;
    setPreparo(p);
    dialogo.current?.showModal();
  }

  function assinarEEnviar() {
    const a = assinante.current;
    if (!a || !preparo || !confirmado) return;
    iniciar(async () => {
      let assinatura: string;
      try {
        assinatura = await a.assinar(preparo.signedInfo);
      } catch (e) {
        setEstado({ erro: (e as Error).message });
        return;
      } finally {
        assinante.current = null; // a chave sai da memória da tela antes do envio
      }
      let r: EstadoDaAcao;
      try {
        r = await transmitir(empresaId, pa, { preparoId: preparo.preparoId, assinatura, aPagar: preparo.aPagar, confirmado: true });
      } catch {
        r = { erro: "Não foi possível falar com o servidor. Confira a conexão e tente de novo." };
      }
      setEstado(r);
      descartar();
      dialogo.current?.close();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <Assinador
        cnpj={cnpj}
        id="dctf"
        rotulo="Assinar e transmitir"
        pendente="Preparando…"
        desabilitado={enviando}
        aoAssinante={aoAssinante}
        explicacaoArquivo={
          <Explicacao
            rotulo="Por que a DCTFWeb pede o certificado da empresa?"
            texto={[
              "A Receita Federal exige que a DCTFWeb seja assinada com o certificado digital de quem declara: o e-CNPJ A1 da própria empresa.",
              "A assinatura é feita aqui no navegador. O arquivo, a chave e a senha não saem do seu computador; só a assinatura vai para a Receita.",
            ]}
          />
        }
      />
      <Situacao estado={estado} />
      <dialog ref={dialogo} className={DIALOGO} aria-labelledby={`dctf-${pa}-titulo`} onClose={descartar}>
        <div className="flex flex-col gap-4 px-5 py-5">
          <h2 id={`dctf-${pa}-titulo`} className="text-lg font-semibold tracking-tight">
            Transmitir a DCTFWeb
          </h2>
          <dl className="text-sm">
            {[...resumo, ["Valor a pagar na declaração", brl(preparo?.aPagar ?? 0)] as [string, string]].map(([nome, valor]) => (
              <div key={nome} className="flex flex-wrap justify-between gap-x-4 border-t border-line py-2">
                <dt className="text-muted">{nome}</dt>
                <dd className="font-medium tabular-nums">{valor}</dd>
              </div>
            ))}
          </dl>
          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} className="mt-1 size-4" />
            <span>Confirmo a DCTFWeb com {brl(preparo?.aPagar ?? 0)} de INSS a pagar. Sei que ela será assinada com o certificado da empresa e enviada à Receita Federal.</span>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Botao type="button" onClick={assinarEEnviar} disabled={!confirmado || enviando}>
              {enviando ? "Assinando e enviando…" : "Confirmar e enviar"}
            </Botao>
            <Botao type="button" leve onClick={() => dialogo.current?.close()} disabled={enviando}>
              Cancelar
            </Botao>
          </div>
        </div>
      </dialog>
    </div>
  );
}
