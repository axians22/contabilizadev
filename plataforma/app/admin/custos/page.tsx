import { Explicacao } from "@/app/explicacao";
import { Tabela } from "@/app/tabela";
import { Secao, Titulo, botaoLink } from "@/app/ui";
import { banco } from "@/banco";
import { brl, dataBr, formatarCnpj } from "@contabilizadev/nucleo/formato";
import { NOMES, ultimoDiaDoPeriodo } from "@contabilizadev/nucleo/serpro/precos";
import { exigirAreaDoAdmin } from "@/lib/autenticacao/servidor";
import { custosPorCliente, DESDE_O_INICIO, escolhaDoEndereco, periodosComChamadas, TIPOS, type Quantidades } from "@/lib/serpro/custos";

export const metadata = { title: "Custos · ContabilizaDev" };

// Área do administrador, só ADMIN: o custo por cliente das chamadas ao Serpro, lido só do banco (serpro_chamadas). O
// período é o de cobrança do Serpro (21 a 20); o cálculo e a regra de arredondamento estão em lib/serpro/custos.ts.
// O custo total da plataforma (projeção, limite do contrato) fica para uma tela seguinte.
const nomeDoPeriodo = (chave: string) => (chave === DESDE_O_INICIO ? "Desde o início" : `${dataBr(chave)} a ${dataBr(ultimoDiaDoPeriodo(chave))}`);
const reais = (centavos: number) => brl(centavos / 100);
const numero = (n: number) => n.toLocaleString("pt-BR");
const celulasDeQuantidade = (q: Quantidades) => Object.fromEntries(TIPOS.map((t) => [t, numero(q[t])]));

export default async function Custos({ searchParams }: { searchParams: Promise<{ periodo?: string | string[] }> }) {
  await exigirAreaDoAdmin("/admin/custos");
  const agora = new Date();
  const { periodo } = await searchParams;
  const periodos = await periodosComChamadas(banco(), agora);
  const pedido = escolhaDoEndereco(periodo, agora);
  // Período válido mas sem chamadas (e que não é o atual): mostra o atual, como um endereço inválido.
  const escolha = pedido === DESDE_O_INICIO || periodos.includes(pedido) ? pedido : periodos[0];
  const custos = await custosPorCliente(banco(), escolha);

  return (
    <>
      <Titulo
        sobre="Administração · só administradores"
        explicacao={
          <Explicacao
            rotulo="Como é calculado o custo por cliente?"
            texto={[
              "Cada chamada cobrada ao Serpro (consulta, emissão ou declaração) entra no cliente que a originou; a autenticação não é cobrada e não entra.",
              "O Serpro cobra todas as chamadas de um tipo no período pelo preço da faixa em que caiu o total daquele tipo, somando todos os clientes. O custo de cada cliente usa esse preço da faixa, e a soma dos clientes é o custo do período. Em \"Desde o início\", cada período usa a sua faixa.",
              "É o preço da faixa: recusas (por exemplo, falta de autorização) podem não ser cobradas pelo Serpro. Os valores são centavos exatos, sem arredondamento.",
            ]}
          />
        }
      >
        Custos
      </Titulo>

      <form className="flex flex-wrap items-end gap-3" method="get">
        <label htmlFor="periodo" className="flex flex-col gap-1.5 text-sm font-medium text-muted">
          Período de cobrança
          <select id="periodo" name="periodo" defaultValue={escolha} className="h-10 rounded-xl border border-line bg-surface px-3 font-normal text-fg hover:border-muted">
            {periodos.map((p, i) => (
              <option key={p} value={p}>
                {nomeDoPeriodo(p)}
                {i === 0 ? " (atual)" : ""}
              </option>
            ))}
            <option value={DESDE_O_INICIO}>{nomeDoPeriodo(DESDE_O_INICIO)}</option>
          </select>
        </label>
        <button type="submit" className={botaoLink}>
          Ver
        </button>
      </form>

      <Secao
        titulo="Custo por cliente"
        explicacao={
          <Explicacao
            rotulo="Quem aparece no custo por cliente?"
            lista={[
              "Uma linha por empresa cadastrada, inclusive a da própria plataforma.",
              "Empresas removidas: as chamadas delas ficam anonimizadas e entram juntas numa linha só.",
              "Plataforma (sem empresa): chamadas feitas sem contribuinte.",
            ]}
            texto="O período vai do dia 21 ao dia 20 do mês seguinte, no horário de Brasília, como a cobrança do Serpro."
          />
        }
      >
        <Tabela
          rotulo={`Custo por cliente: ${nomeDoPeriodo(escolha)}`}
          vazio="Nenhuma chamada cobrada neste período."
          colunas={[
            { chave: "cliente", titulo: "Cliente", principal: true },
            ...TIPOS.map((t) => ({ chave: t, titulo: NOMES[t], alinhar: "direita" as const })),
            { chave: "custo", titulo: "Custo", alinhar: "direita" },
          ]}
          linhas={custos.linhas.map((l) => ({
            chave: l.chave,
            celulas: {
              cliente: (
                <span className="flex flex-col">
                  <span className="font-medium">{l.nome}</span>
                  {l.cnpj && <span className="text-xs text-muted tabular-nums">{formatarCnpj(l.cnpj)}</span>}
                </span>
              ),
              ...celulasDeQuantidade(l.quantidades),
              custo: reais(l.centavos),
            },
          }))}
          rodape={custos.linhas.length ? { cliente: escolha === DESDE_O_INICIO ? "Soma desde o início" : "Soma do período", ...celulasDeQuantidade(custos.total.quantidades), custo: reais(custos.total.centavos) } : undefined}
        />
      </Secao>
    </>
  );
}
