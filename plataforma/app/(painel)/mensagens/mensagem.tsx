import { dataBr } from "@contabilizadev/nucleo/formato";
import { decodificar, paragrafos } from "@contabilizadev/nucleo/serpro/mensagem-receita";
import { Explicacao } from "@/app/explicacao";
import type { MensagemGuardada } from "@/lib/caixa-postal/caixa-postal";
import { AVISO_DE_CIENCIA, EXPLICACAO_DA_CIENCIA } from "@/lib/caixa-postal/mensagens";
import { ECAC } from "@/lib/termo/guiado";
import type { EstadoDaAcao } from "../roteiro/acoes";
import { BotaoDeAcao, ConfirmarEnvio } from "../roteiro/componentes";

type Acao = (anterior: EstadoDaAcao, dados: FormData) => Promise<EstadoDaAcao>;

// "2026-10-15T09:29:49" -> "15/10/2026 às 09:29"
export const quandoEnviada = (iso: string | null) => {
  if (!iso) return "data não informada";
  const [data, hora] = iso.split("T");
  return `${dataBr(data)}${hora ? ` às ${hora.slice(0, 5)}` : ""}`;
};

// Começo do texto para mostrar com a mensagem fechada (só das já abertas), pulando saudação e identificação.
const resumo = (conteudo: string) =>
  paragrafos(conteudo)
    .map((trechos) => trechos.map((t) => t.texto).join("").trim())
    .filter((p) => p && !/^(prezad|nome:|cpf|cnpj|atenciosamente|secretaria especial)/i.test(p))
    .join(" ");

const pilula = "rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap";

// Uma mensagem da Caixa Postal em lista suspensa: o cabeçalho (assunto, data, remetente, importante, lida) fica visível
// com ela fechada; aberta, mostra o conteúdo guardado ou o botão de abrir. O conteúdo de uma mensagem ainda não lida só é
// buscado depois da confirmação de que a Receita vai registrar a ciência (o texto vem como HTML da Receita e vira só texto
// e links, sem HTML de fora na página).
export function MensagemDaCaixa({ m, nova, empresaId, autorizada, abrir }: { m: MensagemGuardada; nova: boolean; empresaId: string; autorizada: boolean; abrir: Acao }) {
  const assunto = decodificar(m.assunto) || "Mensagem sem assunto";
  const lida = m.lidaNaReceita || Boolean(m.abertaEm);
  const campos = { empresaId, mensagemId: m.id };
  return (
    <details className="group w-full" open={nova}>
      <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-2 rounded-xl py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
          <b className="font-semibold break-words">{assunto}</b>
          <span className="text-sm text-muted">
            {m.origem || "Receita Federal"} · enviada em {quandoEnviada(m.enviadaEm)}
          </span>
          {m.conteudo && <span className="line-clamp-2 text-sm text-fg/80 group-open:hidden">{resumo(m.conteudo)}</span>}
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          {nova && <span className={`${pilula} bg-accent text-on-accent`}>Nova</span>}
          {m.relevante && <span className={`${pilula} bg-warn-soft text-warn`}>Importante</span>}
          <span className={`${pilula} ${lida ? "bg-raised text-muted" : "bg-bad/15 text-bad"}`}>{lida ? "Lida" : "Não lida"}</span>
          <svg viewBox="0 0 24 24" className="size-5 shrink-0 text-muted transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </summary>
      <div className="flex flex-col gap-3 pt-3">
        {m.conteudo !== null ? (
          <div className="flex flex-col gap-2.5 rounded-xl bg-raised/60 px-4 py-3 text-sm leading-relaxed">
            {paragrafos(m.conteudo).map((trechos, i) => (
              <p key={i} className="break-words">
                {trechos.map((t, j) =>
                  t.link ? (
                    <a key={j} className="font-medium text-accent-ink underline underline-offset-2" href={t.link} target="_blank" rel="noopener noreferrer">
                      {t.texto}
                    </a>
                  ) : (
                    <span key={j}>{t.texto}</span>
                  ),
                )}
              </p>
            ))}
          </div>
        ) : !autorizada ? (
          <span className="text-sm text-muted">
            Para ler, abra a Caixa Postal no {ECAC.nome}.{" "}
            <Explicacao rotulo={`O que acontece ao abrir a mensagem "${assunto}"?`} texto={EXPLICACAO_DA_CIENCIA} link={{ href: ECAC.url, texto: `Abrir o ${ECAC.nome}` }} />
          </span>
        ) : lida ? (
          // Já lida na Receita: a ciência já foi registrada; abrir de novo não muda prazo nenhum.
          <BotaoDeAcao acao={abrir} campos={campos} rotulo="Abrir a mensagem" pendente="Abrindo…" leve />
        ) : (
          <ConfirmarEnvio
            acao={abrir}
            campos={campos}
            rotulo="Abrir a mensagem"
            titulo="Abrir a mensagem da Receita?"
            resumo={[
              ["Assunto", assunto],
              ["Enviada em", quandoEnviada(m.enviadaEm)],
            ]}
            confirmo={`${AVISO_DE_CIENCIA} Entendi e quero abrir.`}
            explicacao={EXPLICACAO_DA_CIENCIA}
            confirmar="Abrir a mensagem"
            pendente="Abrindo…"
          />
        )}
        {!lida && m.cienciaEm && <span className="text-xs text-muted">{`Mesmo sem abrir, a Receita considera a ciência em ${dataBr(m.cienciaEm.slice(0, 10))}.`}</span>}
        {m.abertaEm && <span className="text-xs text-muted">{`Aberta aqui em ${m.abertaEm.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}.`}</span>}
      </div>
    </details>
  );
}
