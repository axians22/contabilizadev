import { mesValido } from "@contabilizadev/nucleo/meses";
import { banco as conexao } from "@/banco";
import { abaDaEmpresa } from "@/lib/abas";
import { atualizarCaixaAoAbrir } from "@/lib/caixa-postal/servidor";
import { exigirConteudo } from "@/lib/empresas/portao-servidor";
import { situacaoFiscalDaEmpresa } from "@/lib/historico/leitura";
import { atualizarAoAbrir } from "@/lib/historico/servidor";
import { resumoDoMes } from "@/lib/painel/resumo";
import { baseDoMes, ultimoMesApuravel } from "@/lib/rotina/base";
import { guiaDoMes, guiasVencidas } from "@/lib/rotina/guias";
import { mesesComGuiaVencida, explicarPendencias } from "@/lib/situacao/pendencias";
import { termoDoServidor } from "@/lib/termo/servidor";
import { liberada } from "@/lib/termo/situacao";
import { situacaoTermo } from "@/lib/termo/termo";
import { PainelDoMes } from "./painel-do-mes";
import { PortaoFechado } from "./portao";
import { gerarGuiaAcao, lancarReceitaAcao, removerReceitaAcao } from "./roteiro/acoes";

// Painel do mês (página inicial), no desenho do painel do ../fiscal (app/page.tsx): abre no último mês trabalhado (o que se
// lança e cujas guias vencem neste mês) e navega pelos meses com ?mes=. Só lê o banco ao abrir; com a autorização em dia, a
// situação fiscal (a cada 2 meses) e a lista da Caixa Postal (uma vez por dia) se atualizam em segundo plano. A tela fica
// em painel-do-mes.tsx. Sem empresa (ou sem plano), o portão mostra o estado vazio; os dados só são lidos com o acesso dele.
export default async function Inicio({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const { usuario, portao } = await exigirConteudo();
  if (portao.estado !== "liberado") {
    return <PortaoFechado aba={abaDaEmpresa("/")} portao={portao} sobre={`Olá, ${usuario.nome.split(" ")[0]}`} />;
  }
  const { empresa, acesso } = portao;
  // Um instante só para a página toda: na virada do mês, o mês do painel e as guias lidas batem sempre.
  const agora = new Date();
  const ultimo = ultimoMesApuravel(agora);
  const pedido = (await searchParams).mes;
  const pa = mesValido(pedido) ? pedido : ultimo;
  const situacao = await situacaoTermo(await termoDoServidor(), acesso);
  const ligado = liberada(situacao);
  if (ligado) {
    await atualizarAoAbrir(acesso, ["situacao"]);
    await atualizarCaixaAoAbrir(acesso); // mensagens da Receita: a lista (só os cabeçalhos) uma vez por dia, para o sino
  }
  const base = await baseDoMes(conexao(), acesso, pa, agora);
  const das = await guiaDoMes(conexao(), acesso, pa, "DAS", agora);
  const inss = await guiaDoMes(conexao(), acesso, pa, "INSS", agora);
  // Situação fiscal: com pendências, os títulos em linguagem simples e os meses com guia vencida que resolve uma delas.
  const situacaoFiscal = await situacaoFiscalDaEmpresa(conexao(), acesso);
  const pendencias = situacaoFiscal.atual?.regular === false ? explicarPendencias(situacaoFiscal.atual.pendencias) : [];
  // Só banco: vale também no modo guiado (sem a autorização), em que o link leva ao portal na seção das guias.
  const vencidas = pendencias.length ? await guiasVencidas(conexao(), acesso, agora) : [];
  const mesesComGuia = mesesComGuiaVencida(pendencias, vencidas);
  return (
    <PainelDoMes
      dados={{
        empresaId: empresa.id,
        base,
        resumo: resumoDoMes(base),
        ultimo,
        das,
        inss,
        situacaoFiscal,
        pendencias: [...new Set(pendencias.map((p) => p.titulo))],
        mesesComGuia,
        autorizada: ligado,
        termo: situacao,
      }}
      acoes={{ lancar: lancarReceitaAcao, remover: removerReceitaAcao, gerar: gerarGuiaAcao }}
    />
  );
}
