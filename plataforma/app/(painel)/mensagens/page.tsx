import { redirect } from "next/navigation";
import { ENDERECO_DAS_MENSAGENS } from "@/lib/abas";
import { exigirSessao } from "@/lib/autenticacao/servidor";

// As mensagens agora são uma aba da página Avisos e mensagens (o sininho abre essa página). O endereço antigo continua
// valendo: confere a sessão (fechado por padrão, como toda página) e leva direto para a aba.
export default async function Mensagens() {
  await exigirSessao();
  redirect(ENDERECO_DAS_MENSAGENS);
}
