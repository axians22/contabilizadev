import Link from "next/link";
import { Explicacao, ExplicacaoDoTermo } from "@/app/explicacao";
import { Cartao, Secao, Titulo, botaoLink } from "@/app/ui";
import { abaDaEmpresa } from "@/lib/abas";
import type { Portao } from "@/lib/empresas/portao";
import { exigirConteudo } from "@/lib/empresas/portao-servidor";
import { formatarCnpj } from "@/lib/empresas/cnpj";
import { termoDoServidor } from "@/lib/termo/servidor";
import { importarSeNuncaImportou } from "@/lib/historico/servidor";
import { liberada } from "@/lib/termo/situacao";
import { prepararAutorizacao } from "@/lib/termo/termo";
import { PortaoFechado } from "../portao";
import { enviarTermoAcao } from "./acoes";
import { AssinarTermo } from "./assinar-termo";
import { CartaoAutorizacao } from "./cartao-autorizacao";
import { TextoOficial } from "./texto-oficial";

export const metadata = { title: "Autorização · ContabilizaDev" };

// Autorização: a empresa assina, aqui no navegador e com o e-CNPJ A1 dela, o termo de autorização para a plataforma
// (lib/termo/termo.ts). É o mesmo fluxo do passo 7 do cadastro (empresas/nova); aqui fica para autorizar depois,
// renovar e ver a situação. A situação vem só do banco: abrir a página não chama nada. O termo é uma camada depois do
// portão: sem empresa (ou sem plano) a aba mostra o estado vazio. A empresa da própria plataforma não precisa de termo.
export default async function Autorizacao() {
  const { portao } = await exigirConteudo();
  if (portao.estado === "aguardando") return <Comprovar portao={portao} />;
  if (portao.estado !== "liberado") return <PortaoFechado aba={abaDaEmpresa("/autorizacao")} portao={portao} />;
  const { empresa, acesso } = portao;
  const deps = await termoDoServidor();
  // O que impede assinar agora (configuração incompleta, CNPJ com letras, não é o dono) vem como mensagem própria.
  const { situacao, parametros, bloqueio } = await prepararAutorizacao(deps, acesso);
  // Com a autorização em dia e nada importado ainda, a importação do histórico começa em segundo plano.
  if (liberada(situacao)) await importarSeNuncaImportou(acesso);
  const indisponivel = Boolean(deps.motivoTecnico);

  return (
    <>
      <Titulo
        sobre={`${empresa.razaoSocial} · CNPJ ${formatarCnpj(empresa.cnpj)}`}
        explicacao={
          <Explicacao
            rotulo="O que é a autorização?"
            titulo="Autorização"
            texto={[
              "Com o termo de autorização assinado pela empresa, declarações, guias e consultas à Receita Federal são feitas aqui mesmo, sempre com a sua confirmação.",
              "O termo vale 1 ano (ou até o certificado vencer). Avisamos antes de vencer para você assinar de novo.",
              "Sem ele, tudo continua funcionando no modo guiado: calculamos e mostramos o que lançar no portal.",
            ]}
          />
        }
      >
        Autorização
      </Titulo>

      <CartaoAutorizacao situacao={situacao} indisponivel={indisponivel} />
      {situacao.estado !== "propria" && (
        <Secao
          titulo={situacao.estado === "ausente" ? "Assinar o termo de autorização" : "Assinar de novo"}
          explicacao={<ExplicacaoDoTermo termo="termo" />}
        >
          {parametros ? (
            <AssinarTermo
              empresaId={empresa.id}
              parametros={parametros}
              textoOficial={<TextoOficial contratante={parametros.contratante} empresa={parametros.empresa} />}
              enviar={enviarTermoAcao}
            />
          ) : (
            <Cartao className="border-warn/40 bg-warn-soft px-5 py-4 text-sm">{bloqueio}</Cartao>
          )}
        </Secao>
      )}

      <div>
        <Link className={botaoLink} href="/">
          Voltar ao painel
        </Link>
      </div>
    </>
  );
}

// Empresa aguardando comprovação (cadastro provisório): esta é a única aba que abre, com o termo para assinar. O termo
// assinado com o e-CNPJ em nome do CPF do usuário é a prova de que a empresa é dele; nenhum dado da empresa aparece aqui.
async function Comprovar({ portao }: { portao: Extract<Portao, { estado: "aguardando" }> }) {
  const { empresa } = portao;
  const { parametros, bloqueio } = await prepararAutorizacao(await termoDoServidor(), portao.termo);
  return (
    <>
      <Titulo
        sobre={`${empresa.razaoSocial} · CNPJ ${formatarCnpj(empresa.cnpj)}`}
        explicacao={
          <Explicacao
            rotulo="Por que preciso comprovar que a empresa é minha?"
            titulo="Comprovação da empresa"
            texto={[
              "Qualquer pessoa pode digitar um CNPJ. Para ninguém ver os dados de uma empresa que não é sua, conferimos o termo assinado com o e-CNPJ A1 da empresa: ele precisa ter sido emitido pela ICP-Brasil para o seu CPF (o mesmo de Seus dados).",
              "Assinado o termo, a empresa fica comprovada, o conteúdo abre e a autorização já fica valendo.",
            ]}
          />
        }
      >
        Autorização
      </Titulo>
      <Cartao className="flex flex-col gap-1 border-warn/40 bg-warn-soft px-5 py-4 text-sm">
        <b className="font-semibold">Esta empresa aguarda comprovação.</b>
        <span>Assine o termo de autorização com o e-CNPJ da empresa, emitido em nome do seu CPF.</span>
      </Cartao>
      <Secao titulo="Assinar o termo de autorização" explicacao={<ExplicacaoDoTermo termo="termo" />}>
        {parametros ? (
          <AssinarTermo
            empresaId={empresa.id}
            parametros={parametros}
            textoOficial={<TextoOficial contratante={parametros.contratante} empresa={parametros.empresa} />}
            enviar={enviarTermoAcao}
            comprovacao
          />
        ) : (
          <Cartao className="border-warn/40 bg-warn-soft px-5 py-4 text-sm">{bloqueio}</Cartao>
        )}
      </Secao>
    </>
  );
}
