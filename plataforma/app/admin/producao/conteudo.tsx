import Link from "next/link";
import { Explicacao } from "@/app/explicacao";
import { Tabela } from "@/app/tabela";
import { Cartao, Secao } from "@/app/ui";
import type { ItemDaConferencia } from "@/lib/producao/conferencia";
import { GUIA, VARIAVEIS, VARIAVEIS_PROIBIDAS, type Fonte, type Passo } from "@/lib/producao/guia";
import { ENDERECO_DA_SAUDE } from "@/lib/producao/saude";
import { Comando } from "./comando";

// O que a página /admin/produção desenha, separado da barreira (page.tsx) para os testes: a conferência do ambiente no topo
// (OK/Falta por item, o detalhe no tooltip, nunca o valor de um segredo), a rota de saúde e o passo a passo do Coolify em
// seções com checklist (lib/producao/guia.ts), cada passo com a fonte.

const selo = "inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap";
const SELO_OK = "bg-accent text-on-accent";
const SELO_FALTA = "bg-bad text-white";

function Conferencia({ itens }: { itens: ItemDaConferencia[] }) {
  const ok = itens.filter((i) => i.ok).length;
  return (
    <Secao
      titulo="Conferência deste ambiente"
      explicacao={
        <Explicacao
          rotulo="O que a conferência do ambiente verifica?"
          texto={[
            "O que o servidor consegue conferir sozinho, agora, sem chamar nenhum serviço de fora: variáveis de ambiente, banco, migrações, certificado guardado e o protocolo desta requisição.",
            "Os segredos aparecem só como presentes ou ausentes, nunca o valor. No computador de desenvolvimento, vários itens ficam como Falta: é o esperado.",
          ]}
        />
      }
    >
      <Cartao className="px-5 py-2">
        <p className="border-b border-line py-2.5 text-sm text-muted">
          <b className="font-semibold text-fg tabular-nums">
            {ok} de {itens.length}
          </b>{" "}
          em OK
        </p>
        <ul aria-label="Conferência do ambiente" className="text-sm">
          {itens.map((i) => (
            <li key={i.chave} data-item={i.chave} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line py-2.5 first:border-t-0">
              <span className="flex items-center gap-1 font-medium">
                {i.nome}
                <Explicacao rotulo={`O que é o item ${i.nome}?`} texto={i.explicacao} />
              </span>
              <span className="flex items-center gap-2">
                <span className="text-muted">{i.situacao}</span>
                <span className={`${selo} ${i.ok ? SELO_OK : SELO_FALTA}`}>{i.ok ? "OK" : "Falta"}</span>
              </span>
            </li>
          ))}
        </ul>
      </Cartao>
    </Secao>
  );
}

function Saude() {
  return (
    <Cartao className="flex flex-wrap items-center gap-x-2 gap-y-1 px-5 py-4 text-sm">
      <b className="font-semibold">Rota de saúde</b>
      <code className="rounded bg-raised px-1.5 py-0.5 font-mono text-xs">GET {ENDERECO_DA_SAUDE}</code>
      <Explicacao
        rotulo="Para que serve a rota de saúde?"
        texto={[
          "É o endereço do health check do Coolify (passo 4) e do monitor de disponibilidade (passo 8). Abre sem login.",
          'Responde 200 {"ok":true} quando a aplicação e o banco respondem e 503 {"ok":false} quando o banco não responde. Não mostra versão, segredo nem dado nenhum.',
        ]}
      />
    </Cartao>
  );
}

// Fonte do passo: link externo (documentação), link interno (página da área) ou o arquivo do projeto.
function Fontes({ fontes }: { fontes: Fonte[] }) {
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
      <span>Fonte:</span>
      {fontes.map((f) =>
        f.href.startsWith("https://") ? (
          <a key={f.href} href={f.href} target="_blank" rel="noreferrer" className="underline decoration-line underline-offset-2 hover:text-fg">
            {f.texto}
          </a>
        ) : f.href.startsWith("/") ? (
          <Link key={f.href} href={f.href} className="underline decoration-line underline-offset-2 hover:text-fg">
            {f.texto}
          </Link>
        ) : (
          <span key={f.href}>
            {f.texto} (<code className="font-mono">{f.href}</code>)
          </span>
        ),
      )}
    </span>
  );
}

function ItemDoPasso({ passo }: { passo: Passo }) {
  return (
    <li data-passo={passo.id} className="flex gap-3 border-t border-line py-3 first:border-t-0">
      <span aria-hidden="true" className="mt-0.5 size-4 shrink-0 rounded border border-muted" />
      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="text-sm">
          {passo.texto}
          {passo.detalhe && (
            <span className="ml-1 inline-flex align-middle">
              <Explicacao rotulo={`Detalhes do passo: ${passo.texto}`} texto={passo.detalhe} />
            </span>
          )}
        </span>
        {passo.comando && <Comando texto={passo.comando} rotulo={passo.texto} />}
        <Fontes fontes={passo.fontes} />
      </span>
    </li>
  );
}

function Variaveis() {
  return (
    <div className="flex flex-col gap-3">
      <Tabela
        rotulo="Variáveis de ambiente da aplicação no Coolify"
        porPagina={10}
        colunas={[
          { chave: "nome", titulo: "Variável", principal: true },
          { chave: "obrigatoria", titulo: "Obrigatória" },
          { chave: "oQueFaz", titulo: "O que faz" },
          { chave: "gerar", titulo: "Como gerar" },
        ]}
        linhas={VARIAVEIS.map((v) => ({
          chave: v.nome,
          celulas: {
            nome: <code className="font-mono text-xs">{v.nome}</code>,
            obrigatoria: v.obrigatoria ? "Sim" : "Não",
            oQueFaz: v.oQueFaz,
            gerar: v.gerar ? <code className="font-mono text-xs">{v.gerar}</code> : v.valor ? <code className="font-mono text-xs">{v.valor}</code> : "—",
          },
        }))}
      />
      <Cartao className="px-5 py-2">
        <ul aria-label="Variáveis que não entram em produção" className="text-sm">
          {VARIAVEIS_PROIBIDAS.map((v) => (
            <li key={v.nome} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line py-2.5 first:border-t-0">
              <span className="flex items-center gap-1 font-medium">
                <code className="font-mono text-xs">{v.nome}</code>
                <Explicacao rotulo={`Por que ${v.nome} não entra em produção?`} texto={v.porque} />
              </span>
              <span className={`${selo} ${SELO_FALTA}`}>Não criar</span>
            </li>
          ))}
        </ul>
      </Cartao>
    </div>
  );
}

export function ConteudoDaProducao({ itens }: { itens: ItemDaConferencia[] }) {
  return (
    <>
      <Conferencia itens={itens} />
      <Saude />
      {GUIA.map((s) => (
        <Secao key={s.id} titulo={s.titulo}>
          <p className="-mt-2 text-sm text-muted">{s.resumo}</p>
          <Cartao className="px-5 py-1">
            <ol aria-label={s.titulo} className="flex flex-col">
              {s.passos.map((p) => (
                <ItemDoPasso key={p.id} passo={p} />
              ))}
            </ol>
          </Cartao>
          {s.id === "variaveis" && <Variaveis />}
        </Secao>
      ))}
    </>
  );
}
