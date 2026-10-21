import { AbasDaPagina } from "@/app/abas-da-pagina";
import { Cartao, Secao } from "@/app/ui";
import { ABAS_DO_PLANO, capitalizar, contagemDeSeguranca, type AbaDoPlano, type Gravidade, type Plano, type Seguranca } from "@/lib/plano";

// O que a página /admin/plano desenha, separado da barreira (page.tsx) para dar para testar sem sessão: as abas (o
// mesmo padrão de Avisos e mensagens, com a aba no endereço), a aba Plano (introdução, partes e listas) e a aba
// Segurança (a seção SEGURANÇA do plano.txt).

// As cores das gravidades seguem as da central de avisos (Urgente, Atenção, Para saber): Alta é a mais forte.
const SELO: Record<Gravidade, string> = {
  Alta: "bg-bad text-white",
  Média: "bg-warn-soft text-warn",
  Baixa: "bg-raised text-muted",
  Decisão: "border border-line bg-surface text-fg",
};
const SELO_FEITO = "bg-accent text-on-accent";
const selo = "inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap";

export function ConteudoDoPlano({ plano, aba }: { plano: Plano; aba: AbaDoPlano }) {
  return (
    <>
      <AbasDaPagina rotulo="Plano do projeto" abas={ABAS_DO_PLANO} atual={aba} />
      {aba === "seguranca" ? <AbaSeguranca seguranca={plano.seguranca} /> : <AbaPlano plano={plano} />}
    </>
  );
}

function AbaPlano({ plano }: { plano: Plano }) {
  // Introdução: "- " vira item; linha recuada continua o item anterior; o resto vira parágrafo
  // (e linha sem recuo logo depois de um parágrafo continua o mesmo parágrafo).
  const blocos: { tipo: "p" | "ul"; linhas: string[] }[] = [];
  for (const linha of plano.introducao) {
    const item = linha.match(/^-\s+(.*)$/);
    const ultimo = blocos[blocos.length - 1];
    if (item) {
      if (ultimo?.tipo === "ul") ultimo.linhas.push(item[1]);
      else blocos.push({ tipo: "ul", linhas: [item[1]] });
    } else if (/^\s/.test(linha) && ultimo?.tipo === "ul") {
      ultimo.linhas[ultimo.linhas.length - 1] += ` ${linha.trim()}`;
    } else if (ultimo?.tipo === "p" && !/:$/.test(ultimo.linhas[0]) && !/:$/.test(linha)) {
      ultimo.linhas[0] += ` ${linha.trim()}`;
    } else {
      blocos.push({ tipo: "p", linhas: [linha.trim()] });
    }
  }

  return (
    <>
      <Cartao className="flex flex-col gap-2 px-5 py-4 text-sm leading-relaxed">
        {blocos.map((b, i) =>
          b.tipo === "p" ? (
            <p key={i} className={/:$/.test(b.linhas[0]) ? "pt-1 font-semibold" : ""}>{b.linhas[0]}</p>
          ) : (
            <ul key={i} className="flex list-disc flex-col gap-1 pl-5 text-muted">
              {b.linhas.map((l, j) => (
                <li key={j}>{l}</li>
              ))}
            </ul>
          ),
        )}
      </Cartao>

      <ol className="flex flex-col gap-3">
        {plano.partes.map((p) => (
          <li key={p.numero}>
            <Cartao className={`flex flex-col gap-3 px-5 py-4 ${p.feito ? "border-accent-ink/30 bg-accent/10" : ""}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="flex items-baseline gap-3 font-semibold">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-fg text-xs text-bg tabular-nums">{p.numero}</span>
                  <span>{capitalizar(p.nome)}</span>
                </h2>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${p.feito ? SELO_FEITO : "bg-raised text-muted"}`}>
                  {p.feito ? "Feito" : "A fazer"}
                </span>
              </div>
              {p.nota && p.feito && <span className="text-sm text-muted">{p.nota.replace(/^feito\s*/i, "Feito ")}</span>}
              <ul className="flex flex-col gap-1.5 text-sm">
                {p.passos.map((s) => (
                  <li key={s.numero} className="flex gap-3">
                    <span className="w-6 shrink-0 text-right text-muted tabular-nums">{s.numero}.</span>
                    <span className="flex flex-col gap-1 leading-relaxed">
                      {s.texto}
                      {s.subitens.length > 0 && (
                        <ul className="flex list-disc flex-col gap-0.5 pl-5 text-muted">
                          {s.subitens.map((sub, k) => (
                            <li key={k}>{sub}</li>
                          ))}
                        </ul>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </Cartao>
          </li>
        ))}
      </ol>

      {plano.listas.map((l) => (
        <Secao key={l.titulo} titulo={capitalizar(l.titulo)}>
          <Cartao className="px-5 py-4">
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed">
              {l.itens.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </Cartao>
        </Secao>
      ))}
    </>
  );
}

function AbaSeguranca({ seguranca }: { seguranca: Seguranca | null }) {
  if (!seguranca) return <p className="text-sm text-muted">O plano ainda não tem a seção Segurança.</p>;
  const { porGravidade, feitos } = contagemDeSeguranca(seguranca.itens);
  return (
    <>
      <ul aria-label="Achados por gravidade" className="flex flex-wrap gap-2">
        {porGravidade.map(({ gravidade, total }) => (
          <li key={gravidade} className={`${selo} gap-1.5 ${SELO[gravidade]}`}>
            <span className="tabular-nums">{total}</span> {gravidade}
          </li>
        ))}
        <li className={`${selo} gap-1.5 ${SELO_FEITO}`}>
          <span className="tabular-nums">{feitos}</span> {feitos === 1 ? "Feito" : "Feitos"}
        </li>
      </ul>

      {seguranca.introducao && (
        <Cartao className="px-5 py-4 text-sm leading-relaxed">
          <p>{seguranca.introducao}</p>
        </Cartao>
      )}

      <ol className="flex flex-col gap-2">
        {seguranca.itens.map((item, i) => (
          <li key={i}>
            <Cartao className={`flex flex-col gap-1.5 px-5 py-3 text-sm leading-relaxed sm:flex-row sm:items-baseline sm:gap-4 ${item.feito ? "border-accent-ink/30 bg-accent/10" : ""}`}>
              <span className="flex shrink-0 gap-1.5 sm:w-32">
                {item.feito ? (
                  <span className={`${selo} ${SELO_FEITO}`}>Feito</span>
                ) : item.gravidade ? (
                  <span className={`${selo} ${SELO[item.gravidade]}`}>{item.gravidade}</span>
                ) : null}
              </span>
              <span className="flex min-w-0 flex-col gap-1">
                <span>{item.texto}</span>
                {item.feito && (
                  <span className="text-muted">
                    Feito em {item.feito.data}
                    {item.feito.resumo ? `: ${item.feito.resumo}` : ""}
                    {item.gravidade ? ` · gravidade ${item.gravidade}` : ""}
                  </span>
                )}
              </span>
            </Cartao>
          </li>
        ))}
      </ol>
    </>
  );
}
