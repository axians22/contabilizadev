import { Titulo } from "@/app/ui";
import { exigirAreaDoAdmin } from "@/lib/autenticacao/servidor";
import { abaDoPlano, lerPlano } from "@/lib/plano";
import { ConteudoDoPlano } from "./conteudo";

// Lida do plano.txt da raiz a cada acesso (a página exige sessão, então não é mais gerada no build).
// Área do administrador: o plano cita fornecedores, contratos e códigos que o cliente não vê. Só o ADMIN
// (exigirAreaDoAdmin; nem MANAGER nem o login desligado sem ser ADMIN); para os outros, a página não existe.
// Duas abas: Plano (partes e listas) e Segurança (a auditoria); a aba fica no endereço (?aba=seguranca).

export const metadata = { title: "Plano do projeto · ContabilizaDev" };

export default async function PaginaPlano({ searchParams }: { searchParams: Promise<{ aba?: string | string[] }> }) {
  await exigirAreaDoAdmin("/admin/plano");
  const plano = lerPlano();
  const aba = abaDoPlano((await searchParams).aba);
  const feitas = plano.partes.filter((p) => p.feito).length;

  return (
    <>
      <Titulo sobre={`Administração · ${feitas} de ${plano.partes.length} partes feitas`}>Plano do projeto</Titulo>
      <ConteudoDoPlano plano={plano} aba={aba} />
    </>
  );
}
