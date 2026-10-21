"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { brl } from "@contabilizadev/nucleo/formato";
import { rotuloMes } from "@contabilizadev/nucleo/meses";
import { Assinador } from "@/app/assinador/assinador";
import { Explicacao } from "@/app/explicacao";
import { Botao, Campo } from "@/app/ui";
import type { Assinante } from "@/lib/assinador/assinador";
import { linhasDoResumo } from "@/lib/esocial/resumo";
import type { EstadoEsocial, PassoDaImportacao, PreparoNaTela } from "./acoes";

const DIALOGO =
  "w-[min(34rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-0 text-fg shadow-2xl backdrop:bg-black/50 open:flex open:flex-col";
const SEM_CONEXAO = "Não foi possível falar com o servidor. Confira a conexão e tente de novo.";

function Situacao({ estado }: { estado: EstadoEsocial }) {
  return (
    <span aria-live="polite" className={`text-sm ${estado?.erro ? "text-bad" : "text-accent-ink"}`}>
      {estado?.erro ?? estado?.ok ?? ""}
    </span>
  );
}

const EXPLICACAO_DO_CERTIFICADO = [
  "O eSocial exige que cada evento seja assinado pela própria empresa, com o certificado digital dela (e-CNPJ).",
  "A assinatura é feita aqui no navegador: o arquivo, a chave e a senha não saem do seu computador. Só os eventos assinados são enviados ao eSocial pela plataforma.",
];

// O mês no eSocial, assinado aqui no navegador com o e-CNPJ A1 da empresa, pelo assinador único ("Usar só agora" ou
// "Guardar neste navegador"): o servidor prepara os eventos (S-1200, S-1210, S-1299 ou a retificação), a confirmação
// abre com o resumo e, confirmado, o navegador assina todos de uma vez (uma assinatura por mês) e o servidor envia.
export function AssinarEsocial({
  empresaId,
  cnpj,
  mes,
  retificar = false,
  pagamento,
  semDemonstrativoAnterior = null,
  rotulo,
  preparar,
  enviar,
}: {
  empresaId: string;
  cnpj: string;
  mes: string;
  retificar?: boolean;
  pagamento: { dtPgto: string; min: string; max: string } | null;
  semDemonstrativoAnterior?: string | null; // pago no mês seguinte, sem o envio do mês anterior aqui
  rotulo: string;
  preparar: (empresaId: string, mes: string, certificado: string, opcoes: { retificar?: boolean; dtPgto?: string | null; semPagamentoAnterior?: boolean }) => Promise<PreparoNaTela>;
  enviar: (empresaId: string, mes: string, envio: { envioId: string; assinaturas: { idEvento: string; valor: string }[]; proLabore: number; confirmado: boolean }) => Promise<EstadoEsocial>;
}) {
  const router = useRouter();
  const assinante = useRef<Assinante | null>(null);
  const dialogo = useRef<HTMLDialogElement>(null);
  const [dtPgto, setDtPgto] = useState(pagamento?.dtPgto ?? "");
  const [preparo, setPreparo] = useState<Exclude<PreparoNaTela, { erro: string }> | null>(null);
  const [confirmado, setConfirmado] = useState(false);
  const [semAnterior, setSemAnterior] = useState(false);
  const [estado, setEstado] = useState<EstadoEsocial>(undefined);
  const [enviando, iniciar] = useTransition();
  const id = `esocial-${retificar ? "retificar" : "mes"}`;

  const descartar = () => {
    assinante.current = null;
    setPreparo(null);
    setConfirmado(false);
  };

  async function aoAssinante(a: Assinante) {
    setEstado(undefined);
    let p: PreparoNaTela;
    try {
      p = await preparar(empresaId, mes, a.info.certificadoBase64, { retificar, dtPgto: pagamento ? dtPgto : null, semPagamentoAnterior: semAnterior });
    } catch {
      p = { erro: SEM_CONEXAO };
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
      let assinaturas: { idEvento: string; valor: string }[];
      try {
        assinaturas = [];
        for (const x of preparo.assinaturas) assinaturas.push({ idEvento: x.idEvento, valor: await a.assinar(x.signedInfo) });
      } catch (e) {
        setEstado({ erro: (e as Error).message });
        return;
      } finally {
        assinante.current = null; // a chave sai da memória da tela antes do envio
      }
      let r: EstadoEsocial;
      try {
        r = await enviar(empresaId, mes, { envioId: preparo.envioId, assinaturas, proLabore: preparo.resumo.proLabore, confirmado: true });
      } catch {
        r = { erro: SEM_CONEXAO };
      }
      setEstado(r);
      descartar();
      dialogo.current?.close();
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {pagamento && !retificar && (
        <Campo
          rotulo="Data em que o pró-labore foi pago"
          id={`${id}-dtPgto`}
          type="date"
          min={pagamento.min}
          max={pagamento.max}
          value={dtPgto}
          onChange={(e) => setDtPgto(e.target.value)}
          explicacao={
            <Explicacao
              rotulo="Que pagamento é este?"
              texto={[
                "O eSocial pede, todo mês, o pagamento do pró-labore feito no mês: a data e o valor líquido (o pró-labore menos o INSS).",
                "A data vem do cadastro (dia do pagamento). Se pagou em outro dia, ajuste aqui.",
              ]}
            />
          }
        />
      )}
      {semDemonstrativoAnterior && !retificar && (
        <label className="flex items-start gap-2.5 text-sm">
          <input type="checkbox" checked={semAnterior} onChange={(e) => setSemAnterior(e.target.checked)} className="mt-1 size-4" />
          <span className="flex items-center gap-1">
            Fechar o mês sem o pagamento do pró-labore de {rotuloMes(semDemonstrativoAnterior)}
            <Explicacao
              rotulo="Por que o pagamento pode ficar de fora?"
              texto={[
                `O pró-labore de ${rotuloMes(semDemonstrativoAnterior)} é pago neste mês (cadastro: pago no mês seguinte), e o eSocial pede esse pagamento ligado ao envio daquele mês.`,
                `O envio de ${rotuloMes(semDemonstrativoAnterior)} não está aqui. Se o contador enviou, importe esse mês do eSocial na aba eSocial e o pagamento vai junto.`,
                "Marque só se o pró-labore daquele mês não foi ao eSocial: então o mês fecha sem esse pagamento.",
              ]}
            />
          </span>
        </label>
      )}
      <Assinador
        cnpj={cnpj}
        id={id}
        rotulo={rotulo}
        pendente="Preparando…"
        desabilitado={enviando}
        aoAssinante={aoAssinante}
        explicacaoArquivo={<Explicacao rotulo="Por que o eSocial pede o certificado da empresa?" texto={EXPLICACAO_DO_CERTIFICADO} />}
      />
      <Situacao estado={estado} />
      <dialog ref={dialogo} className={DIALOGO} aria-labelledby={`${id}-titulo`} onClose={descartar}>
        <div className="flex flex-col gap-4 px-5 py-5">
          <h2 id={`${id}-titulo`} className="flex items-center gap-1 text-lg font-semibold tracking-tight">
            {retificar ? `Retificar o pró-labore de ${rotuloMes(mes)} no eSocial` : `Enviar ${rotuloMes(mes)} ao eSocial`}
            <Explicacao
              rotulo="O que acontece ao confirmar?"
              texto={[
                "Os eventos são assinados aqui com o certificado da empresa e a plataforma os envia ao eSocial, um lote de cada vez (o fechamento só depois de a remuneração ser aceita).",
                "O fechamento do mês pede ao eSocial a transmissão da DCTFWeb do INSS: não precisa assinar a DCTFWeb de novo. Depois, gere o DARF no passo seguinte.",
                ...(retificar
                  ? ["A retificação reabre o mês, troca a remuneração enviada pela nova e fecha o mês de novo. A Receita gera a DCTFWeb retificadora e o eSocial a transmite; depois, gere o DARF com o valor novo."]
                  : []),
              ]}
            />
          </h2>
          <dl className="text-sm">
            {(preparo ? linhasDoResumo(preparo.resumo) : []).map(([nome, valor]) => (
              <div key={nome} className="flex flex-wrap justify-between gap-x-4 border-t border-line py-2">
                <dt className="text-muted">{nome}</dt>
                <dd className="font-medium tabular-nums">{valor}</dd>
              </div>
            ))}
          </dl>
          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} className="mt-1 size-4" />
            <span>
              Confirmo o pró-labore de {brl(preparo?.resumo.proLabore ?? 0)} em {rotuloMes(mes)}. Sei que os eventos serão assinados com o certificado da empresa e
              enviados ao eSocial{retificar ? " em substituição aos que foram enviados antes" : ""}.
            </span>
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

// Importar os cadastros do eSocial: o CPF do sócio e o mês cujos eventos o contador já enviou; o cliente abre o
// certificado uma vez e a tela assina as duas consultas (procurar e baixar) em seguida.
export function ImportarDoEsocial({
  empresaId,
  cnpj,
  meses,
  cpf: cpfInicial,
  preparar,
  procurar,
  baixar,
}: {
  empresaId: string;
  cnpj: string;
  meses: string[];
  cpf: string;
  preparar: (empresaId: string, cpf: string, mes: string, certificado: string) => Promise<PassoDaImportacao>;
  procurar: (empresaId: string, pedidoId: string, assinatura: string) => Promise<PassoDaImportacao>;
  baixar: (empresaId: string, pedidoId: string, assinatura: string) => Promise<PassoDaImportacao>;
}) {
  const router = useRouter();
  const [cpf, setCpf] = useState(cpfInicial);
  const [mes, setMes] = useState(meses[0] ?? "");
  const [estado, setEstado] = useState<EstadoEsocial>(undefined);

  async function aoAssinante(a: Assinante): Promise<string | null> {
    setEstado(undefined);
    try {
      let passo = await preparar(empresaId, cpf, mes, a.info.certificadoBase64);
      if ("pedidoId" in passo) passo = await procurar(empresaId, passo.pedidoId, await a.assinar(passo.signedInfo));
      if ("pedidoId" in passo) passo = await baixar(empresaId, passo.pedidoId, await a.assinar(passo.signedInfo));
      if ("erro" in passo) return passo.erro;
      if ("fim" in passo) setEstado({ ok: passo.fim });
      router.refresh();
      return null;
    } catch {
      return SEM_CONEXAO;
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Campo
          rotulo="CPF do sócio"
          id="importar-cpf"
          inputMode="numeric"
          value={cpf}
          onChange={(e) => setCpf(e.target.value)}
          placeholder="000.000.000-00"
          explicacao={<Explicacao rotulo="Por que o CPF do sócio?" texto="O eSocial procura os eventos pelo CPF do trabalhador: aqui, o do sócio que recebe o pró-labore." />}
        />
        <label htmlFor="importar-mes" className="flex flex-col gap-1.5 text-sm font-medium text-muted">
          <span className="flex items-center gap-1">
            Mês já enviado pelo contador
            <Explicacao
              rotulo="Qual mês escolher?"
              texto={[
                "Um mês em que o contador já mandou o pró-labore ao eSocial. Os cadastros (rubricas, lotação, matrícula) são copiados de lá.",
                "O eSocial permite 10 consultas por dia por empresa e nenhuma do dia 1 ao 7; a importação usa 2.",
              ]}
            />
          </span>
          <select id="importar-mes" value={mes} onChange={(e) => setMes(e.target.value)} className="h-10 rounded-xl border border-line bg-surface px-3 font-normal text-fg hover:border-muted">
            {meses.map((m) => (
              <option key={m} value={m}>
                {rotuloMes(m)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Assinador
        cnpj={cnpj}
        id="importar"
        rotulo="Assinar e importar"
        pendente="Importando…"
        aoAssinante={aoAssinante}
        explicacaoArquivo={
          <Explicacao
            rotulo="Por que a importação pede o certificado?"
            texto={["O eSocial só mostra os eventos de uma empresa a quem assina com o certificado dela.", "A assinatura é feita aqui no navegador; o arquivo, a chave e a senha não saem do seu computador."]}
          />
        }
      />
      <Situacao estado={estado} />
    </div>
  );
}

type Valores = Partial<Record<"cpf" | "categoria" | "matricula" | "lotacao" | "tabRubrica" | "rubricaProLabore" | "rubricaInss" | "qtdProLabore" | "diaPagamento" | "pagamentoNoMes", string>>;

const CAMPOS: { nome: keyof Valores; rotulo: string; ajuda: string[]; modo?: "numeric" | "decimal"; marcador?: string }[] = [
  { nome: "cpf", rotulo: "CPF do sócio", ajuda: ["O CPF do sócio que recebe o pró-labore."], modo: "numeric", marcador: "000.000.000-00" },
  { nome: "categoria", rotulo: "Categoria", ajuda: ["O código do sócio no cadastro de trabalhador sem vínculo: 723 para sócio, 721 ou 722 para diretor não empregado.", "Está no cadastro do sócio no eSocial (ou pergunte ao contador)."], modo: "numeric", marcador: "723" },
  { nome: "matricula", rotulo: "Matrícula", ajuda: ["A matrícula do sócio no cadastro de trabalhador sem vínculo (muitas vezes 1)."] },
  { nome: "lotacao", rotulo: "Lotação tributária", ajuda: ["O código da lotação tributária da empresa no eSocial (muitas vezes 1)."] },
  { nome: "tabRubrica", rotulo: "Tabela de rubricas", ajuda: ["O identificador da tabela de rubricas da empresa no eSocial (ex.: 0001)."] },
  { nome: "rubricaProLabore", rotulo: "Rubrica do pró-labore", ajuda: ["O código da rubrica que a empresa usa para o pró-labore (ex.: 100)."] },
  { nome: "rubricaInss", rotulo: "Rubrica do INSS descontado", ajuda: ["O código da rubrica do INSS de 11% descontado do sócio (ex.: 843)."] },
  { nome: "qtdProLabore", rotulo: "Quantidade (opcional)", ajuda: ["Se a empresa informa uma quantidade na rubrica do pró-labore (ex.: 220,00 horas), coloque aqui; senão, deixe vazio."], modo: "decimal", marcador: "220,00" },
  { nome: "diaPagamento", rotulo: "Dia do pagamento", ajuda: ["O dia do mês em que o pró-labore é pago (ex.: 5). Dá para ajustar a data em cada envio."], modo: "numeric", marcador: "5" },
];

// Formulário dos cadastros do eSocial, para quem não importa: cada campo com a explicação de onde achar no tooltip.
export function FormularioEsocial({ empresaId, valores, acao }: { empresaId: string; valores: Valores; acao: (anterior: EstadoEsocial, dados: FormData) => Promise<EstadoEsocial> }) {
  const [estado, executar, pendente] = useActionState(acao, undefined);
  return (
    <form action={executar} className="flex flex-col gap-4">
      <input type="hidden" name="empresaId" value={empresaId} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CAMPOS.map((c) => (
          <div key={c.nome} className="flex flex-col gap-1">
            <Campo
              rotulo={c.rotulo}
              id={`config-${c.nome}`}
              name={c.nome}
              defaultValue={valores[c.nome] ?? ""}
              inputMode={c.modo}
              placeholder={c.marcador}
              required={c.nome !== "qtdProLabore"}
              aria-invalid={Boolean(estado?.erros?.[c.nome])}
              explicacao={<Explicacao rotulo={`O que é: ${c.rotulo}?`} texto={c.ajuda} />}
            />
            {estado?.erros?.[c.nome] && <span className="text-xs text-bad">{estado.erros[c.nome]}</span>}
          </div>
        ))}
        <label htmlFor="config-pagamentoNoMes" className="flex flex-col gap-1.5 text-sm font-medium text-muted">
          <span className="flex items-center gap-1">
            Pago em
            <Explicacao rotulo="Em que mês o pró-labore é pago?" texto="O pró-labore de um mês costuma ser pago no começo do mês seguinte (ex.: o de setembro no dia 5 de outubro). Se é pago no próprio mês, escolha a outra opção." />
          </span>
          <select id="config-pagamentoNoMes" name="pagamentoNoMes" defaultValue={valores.pagamentoNoMes ?? "seguinte"} className="h-10 rounded-xl border border-line bg-surface px-3 font-normal text-fg hover:border-muted">
            <option value="seguinte">No mês seguinte</option>
            <option value="mesmo">No próprio mês</option>
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Botao disabled={pendente}>{pendente ? "Salvando…" : "Salvar cadastros"}</Botao>
        <Situacao estado={estado} />
      </div>
    </form>
  );
}

// Enquanto o eSocial processa, a página é recarregada do servidor a cada poucos segundos (o estado fica no banco; ao
// abrir, o servidor consulta o lote quando já é hora).
export function AtualizarSozinho({ ligado }: { ligado: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!ligado) return;
    const id = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(id);
  }, [ligado, router]);
  return null;
}
