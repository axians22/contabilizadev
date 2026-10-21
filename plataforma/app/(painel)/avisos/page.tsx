import { AbasDaPagina, type AbaDaPagina } from "@/app/abas-da-pagina";
import { Explicacao } from "@/app/explicacao";
import { Titulo } from "@/app/ui";
import { banco } from "@/banco";
import { podeVerNoAdmin } from "@/lib/admin";
import { abaDaEmpresa, ENDERECO_DAS_MENSAGENS } from "@/lib/abas";
import { juntarAvisos, NIVEIS, rotuloDosAvisos } from "@/lib/avisos/central";
import { avisosDaEmpresa } from "@/lib/avisos/coleta";
import { resumoDaCaixa } from "@/lib/caixa-postal/caixa-postal";
import { exigirConteudo } from "@/lib/empresas/portao-servidor";
import { avisosDoAdminPara } from "@/lib/plataforma/servidor";
import { termoDoServidor } from "@/lib/termo/servidor";
import { situacaoTermo } from "@/lib/termo/termo";
import { CaixaPostal } from "../mensagens/caixa-postal";
import { PortaoFechado } from "../portao";
import { ListaDeAvisos } from "./lista";

export const metadata = { title: "Avisos e mensagens · ContabilizaDev" };

type Aba = "avisos" | "mensagens";

// Avisos e mensagens (o sininho abre aqui), em duas abas: Avisos, a lista completa da central de avisos (a mesma do sino:
// os da empresa e, para o ADMIN, os da plataforma, como em ../layout.tsx), com a prioridade e o link de onde resolver; e Mensagens, a Caixa Postal da Receita Federal
// (../mensagens/caixa-postal.tsx). A aba fica na URL (?aba=mensagens). Os avisos são só banco: nada é consultado na
// Receita para montá-los.
export default async function AvisosEMensagens({ searchParams }: { searchParams: Promise<{ aba?: string | string[] }> }) {
  const { usuario, portao } = await exigirConteudo();
  const aba = abaDaEmpresa("/avisos");
  // Os do ADMIN (certificado da plataforma) entram com ou sem empresa, pela mesma função do sino: o que o sino conta e
  // manda ver aqui tem de estar aqui.
  const doAdmin = await avisosDoAdminPara(usuario.papel, new Date());
  if (portao.estado !== "liberado")
    return (
      <>
        <PortaoFechado aba={aba} portao={portao} />
        {doAdmin.length > 0 && <ListaDeAvisos avisos={doAdmin} cnpj={null} rotulo={rotuloDosAvisos({ daEmpresa: false, daPlataforma: true })} />}
      </>
    );
  const { empresa, acesso } = portao;
  const atual: Aba = (await searchParams).aba === "mensagens" ? "mensagens" : "avisos";
  // As contagens das duas abas, antes de a aba Mensagens marcar a lista como vista.
  const [daEmpresa, caixa] = await Promise.all([
    avisosDaEmpresa(banco(), acesso, new Date(), { termo: await situacaoTermo(await termoDoServidor(), acesso) }),
    resumoDaCaixa(banco(), acesso),
  ]);
  const avisos = juntarAvisos(daEmpresa, doAdmin);

  const abas: AbaDaPagina<Aba>[] = [
    { id: "avisos", nome: "Avisos", href: "/avisos", contagem: avisos.length, rotuloDaContagem: avisos.length === 1 ? "1 aviso" : `${avisos.length} avisos` },
    {
      id: "mensagens",
      nome: "Mensagens",
      href: ENDERECO_DAS_MENSAGENS,
      contagem: caixa.naoLidas,
      rotuloDaContagem: caixa.naoLidas === 1 ? "1 mensagem não lida" : `${caixa.naoLidas} mensagens não lidas`,
    },
  ];

  return (
    <>
      <Titulo
        sobre={empresa.razaoSocial}
        explicacao={
          <Explicacao
            rotulo="De onde vêm os avisos?"
            texto={[
              "Do que a plataforma já sabe da empresa: situação fiscal, guias vencidas, prazos do PGDAS-D, da DCTFWeb, do eSocial e da declaração anual, Fator R, autorização, certificado guardado neste navegador e mensagens não lidas da Receita Federal.",
              "Cada assunto aparece uma vez só. Resolvido, o aviso some sozinho. As mensagens da Receita Federal ficam na aba Mensagens.",
              ...(podeVerNoAdmin(usuario.papel, "/admin/plataforma")
                ? ["Como administrador, você vê aqui também os avisos da plataforma (como o certificado da plataforma vencendo), que se resolvem na Área do administrador."]
                : []),
            ]}
            lista={Object.values(NIVEIS).map((n) => `${n.rotulo}: ${n.explicacao}`)}
          />
        }
      >
        {aba.nome}
      </Titulo>

      <AbasDaPagina rotulo="Avisos e mensagens" abas={abas} atual={atual} />

      {atual === "avisos" ? <ListaDeAvisos avisos={avisos} cnpj={empresa.cnpj} rotulo={rotuloDosAvisos({ daEmpresa: true, daPlataforma: doAdmin.length > 0 })} /> : <CaixaPostal empresa={empresa} acesso={acesso} />}
    </>
  );
}
