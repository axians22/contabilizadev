import { Explicacao } from "@/app/explicacao";
import { Titulo } from "@/app/ui";
import { banco } from "@/banco";
import { exigirSessaoSemDados } from "@/lib/autenticacao/servidor";
import { hojeNoBrasil } from "@/lib/empresas/receita";
import { identidadeTravada, lerDadosPessoais } from "@/lib/usuarios/dados-pessoais";
import { exigeSeusDados } from "@/lib/usuarios/portao-dos-dados";
import { salvarDadosAcao, buscarCepAcao } from "./acoes";
import { FormularioDados } from "./formulario";

export const metadata = { title: "Seus dados · ContabilizaDev" };

// "Seus dados": no primeiro login do usuário comum, nada abre antes daqui (lib/usuarios/portao-dos-dados.ts); depois,
// pelo menu do usuário, para corrigir. Só os dados do próprio usuário (o id vem da sessão). Só banco: a busca do CEP
// acontece quando o usuário digita.
export default async function SeusDados() {
  const { usuario } = await exigirSessaoSemDados();
  const atuais = await lerDadosPessoais(banco(), usuario.id);
  const travada = await identidadeTravada(banco(), usuario.id);
  const primeiraVez = exigeSeusDados(usuario);
  return (
    <>
      <Titulo
        sobre={usuario.email}
        explicacao={
          <Explicacao
            rotulo="Por que pedimos estes dados?"
            texto={[
              "Para cadastrar uma empresa, conferimos o seu nome e o seu CPF com o quadro de sócios da Receita Federal e, depois, com o e-CNPJ que assina o termo de autorização. Assim ninguém cadastra a empresa de outra pessoa.",
              "CPF, data de nascimento, WhatsApp e endereço só aparecem para você.",
            ]}
          />
        }
      >
        Seus dados
      </Titulo>
      <p className="max-w-2xl text-sm text-muted">{primeiraVez ? "Antes de começar, preencha seus dados. Leva um minuto." : "Confira e corrija seus dados quando precisar."}</p>
      <FormularioDados
        inicial={
          atuais
            ? {
                nomeCompleto: atuais.nomeCompleto,
                cpf: atuais.cpf,
                dataNascimento: atuais.dataNascimento,
                whatsapp: atuais.whatsapp,
                cep: atuais.cep,
                logradouro: atuais.logradouro,
                numero: atuais.numero,
                complemento: atuais.complemento ?? "",
                bairro: atuais.bairro,
                cidade: atuais.cidade,
                uf: atuais.uf,
              }
            : null
        }
        aceitoAntes={!primeiraVez && Boolean(atuais)}
        identidadeTravada={travada && Boolean(atuais)}
        hoje={hojeNoBrasil(new Date())}
        salvar={salvarDadosAcao}
        buscarCep={buscarCepAcao}
      />
    </>
  );
}
