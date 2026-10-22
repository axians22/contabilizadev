import { Explicacao } from "@/app/explicacao";
import { Titulo } from "@/app/ui";
import { exigirAreaDoAdmin } from "@/lib/autenticacao/servidor";
import { conferirAmbiente } from "@/lib/producao/conferencia";
import { fatosDoServidor } from "@/lib/producao/servidor";
import { ConteudoDaProducao } from "./conteudo";

export const metadata = { title: "Produção · ContabilizaDev" };

// Área do administrador, só ADMIN (exigirAreaDoAdmin; nem MANAGER nem o login desligado sem ser ADMIN): como pôr a plataforma
// no ar com o Coolify (lib/producao/guia.ts, espelhado em docs/producao.md) e a conferência do ambiente atual, lida só do
// próprio servidor (variáveis, banco, migrações, certificado guardado, protocolo da requisição). Nenhum serviço externo é
// chamado e nenhum valor de segredo vai para a tela.
export default async function PaginaDaProducao() {
  await exigirAreaDoAdmin("/admin/producao");
  const itens = conferirAmbiente(process.env, await fatosDoServidor());

  return (
    <>
      <Titulo
        sobre="Administração · só administradores"
        explicacao={
          <Explicacao
            rotulo="Como a plataforma vai para a produção?"
            texto={[
              "Num servidor próprio (VPS) com o Coolify v4: ele publica a plataforma pelo docker/Dockerfile a partir do GitHub, com o Postgres como recurso dele, HTTPS automático e backups agendados.",
              "Cada passo cita a fonte (a documentação oficial do Coolify ou o código do projeto). O mesmo passo a passo está em docs/producao.md.",
            ]}
          />
        }
      >
        Produção
      </Titulo>
      <ConteudoDaProducao itens={itens} />
    </>
  );
}
