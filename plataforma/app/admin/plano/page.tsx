import { Cartao, Secao, Titulo } from "@/app/ui";
import { exigirAreaDoAdmin } from "@/lib/autenticacao/servidor";
import { lerPlano } from "@/lib/plano";

// Lida do plano.txt da raiz a cada acesso (a página exige sessão, então não é mais gerada no build).
// Área do administrador: o plano cita fornecedores, contratos e códigos que o cliente não vê. Só o ADMIN
// (exigirAreaDoAdmin; nem MANAGER nem o login desligado sem ser ADMIN); para os outros, a página não existe.

export const metadata = { title: "Plano do projeto · ContabilizaDev" };

// Títulos do plano vêm em maiúsculas: "NÚCLEO (SEM TELA)" -> "Núcleo (sem tela)", mantendo siglas e nomes.
const NOMES: Record<string, string> = { mvp: "MVP", esocial: "eSocial", serpro: "Serpro", cnpj: "CNPJ" };
const capitalizar = (texto: string) =>
  texto
    .toLowerCase()
    .replace(/[a-zçãõáéíóúâêô]+/g, (p) => NOMES[p] ?? p)
    .replace(/^./, (c) => c.toUpperCase());

export default async function PaginaPlano() {
  await exigirAreaDoAdmin("/admin/plano");
  const plano = lerPlano();
  const feitas = plano.partes.filter((p) => p.feito).length;

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
      <Titulo sobre={`Administração · ${feitas} de ${plano.partes.length} partes feitas`}>Plano do projeto</Titulo>

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
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${p.feito ? "bg-accent text-on-accent" : "bg-raised text-muted"}`}>
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
