import { Explicacao } from "@/app/explicacao";
import { Titulo } from "@/app/ui";
import { exigirSessao } from "@/lib/autenticacao/servidor";
import { enviarTermoAcao, prepararAutorizacaoAcao } from "../../autorizacao/acoes";
import { cadastrarEmpresaAcao, consultarCnpjAcao } from "./acoes";
import { Assistente } from "./assistente";

export const metadata = { title: "Cadastrar empresa · ContabilizaDev" };

export default async function CadastrarEmpresa() {
  await exigirSessao();
  return (
    <>
      <Titulo
        sobre="Empresa"
        explicacao={
          <Explicacao
            rotulo="Como funciona o cadastro?"
            texto={[
              "Em poucos passos, buscamos os dados da empresa na Receita Federal e mostramos como ela paga imposto no Simples Nacional. Você só precisa do CNPJ.",
              "No fim, você pode autorizar a plataforma a declarar e gerar guias daqui mesmo, com o certificado digital da empresa, ou deixar para depois.",
            ]}
          />
        }
      >
        Cadastrar empresa
      </Titulo>
      <Assistente consultar={consultarCnpjAcao} cadastrar={cadastrarEmpresaAcao} preparar={prepararAutorizacaoAcao} enviar={enviarTermoAcao} />
    </>
  );
}
