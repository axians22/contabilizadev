// Conferência do ambiente para a página /admin/producao (área do administrador, só ADMIN): o que o servidor consegue
// verificar sozinho, sem chamar nenhum serviço externo. Pura: recebe o ambiente (process.env) e os fatos já lidos do banco e
// da requisição (lib/producao/servidor.ts), para os testes trocarem tudo.
// Nunca devolve o valor de um segredo: só se está presente, válido ou não. Os nomes das variáveis aparecem (a área é
// interna); o conteúdo, nunca.
import { lerConfigAutenticacao, listaDeAdmins, loginDesligado, producao, ErroDeConfiguracao, TAMANHO_MINIMO_DO_SEGREDO } from "@/lib/autenticacao/config";
import { nomeDoCookie } from "@/lib/autenticacao/cookie";
import { lerCnpjPlataforma, lerRazaoPlataforma } from "@/lib/serpro/config";
import { ErroDeChave, lerChavePlataforma, lerChaveToken } from "@/lib/termo/cifra";

type Ambiente = Record<string, string | undefined>;

// Faltando 30 dias ou menos, o certificado ainda vale mas já aparece como Falta (é hora de trocar), como o sino do ADMIN.
export const DIAS_PARA_TROCAR_O_CERTIFICADO = 30;
const DIA = 24 * 60 * 60 * 1000;

export type FatosDoServidor = {
  // O banco respondeu? E as migrações aplicadas (tabela do drizzle-kit) contra as do código (banco/migracoes/meta/_journal.json).
  banco: { ok: true; aplicadas: number; ultimaAplicada: number | null } | { ok: false };
  migracoesDoCodigo: { total: number; ultima: number };
  // O certificado que vale (resolverCertificadoDaPlataforma): de onde veio e até quando vale, ou por que não vale.
  certificado: { pronto: true; origem: "banco" | "ambiente"; validoAte: Date } | { pronto: false; vencidoEm?: Date; motivo: string };
  // As chaves do contrato guardadas na tela /admin/plataforma.
  chaves: "guardadas" | "ilegiveis" | "ambiente" | "faltam";
  // x-forwarded-proto da requisição atual (o proxy do Coolify põe "https"); sem o cabeçalho, null e o item fica Falta.
  protocolo: string | null;
  agora: Date;
};

export type ItemDaConferencia = {
  chave: string;
  nome: string;
  ok: boolean;
  // A frase curta ao lado do OK/Falta (nunca o valor de um segredo).
  situacao: string;
  // O que é e como resolver: vai no <Explicacao>.
  explicacao: string[];
};

const dataBr = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
const GERAR_CHAVE = "Gere com: openssl rand -base64 32";

function chaveValida(ler: () => Buffer): { ok: true } | { ok: false; motivo: "ausente" | "invalida" | "igual" } {
  try {
    ler();
    return { ok: true };
  } catch (erro) {
    if (!(erro instanceof ErroDeChave)) throw erro;
    const m = erro.message;
    return { ok: false, motivo: /ausente/.test(m) ? "ausente" : /igual/.test(m) ? "igual" : "invalida" };
  }
}

const textoDaChave = (r: ReturnType<typeof chaveValida>) =>
  r.ok ? "Presente e válida (32 bytes)" : r.motivo === "ausente" ? "Ausente" : r.motivo === "igual" ? "Igual à TOKEN_CHAVE" : "Presente, mas inválida";

// A conta de desenvolvimento (DEV_USER_EMAIL ou a padrão), que entra sozinha com o login desligado.
function contaDeDesenvolvimento(env: Ambiente): string {
  try {
    return lerConfigAutenticacao(env).emailDesenvolvimento;
  } catch (erro) {
    if (!(erro instanceof ErroDeConfiguracao)) throw erro;
    return (env.DEV_USER_EMAIL?.trim() || "dev@contabilizadev.local").toLowerCase();
  }
}

export function conferirAmbiente(env: Ambiente, fatos: FatosDoServidor): ItemDaConferencia[] {
  const emProducao = producao(env);
  const segredo = env.SESSAO_SEGREDO ?? "";
  const token = chaveValida(() => lerChaveToken(env.TOKEN_CHAVE));
  const plataforma = chaveValida(() => lerChavePlataforma(env.PLATAFORMA_CHAVE, env.TOKEN_CHAVE));
  const admins = listaDeAdmins(env.ADMIN_EMAILS);
  const dev = contaDeDesenvolvimento(env);
  const comDev = admins.includes(dev) || admins.some((e) => e.endsWith("@contabilizadev.local"));
  const cnpj = lerCnpjPlataforma(env);
  const razao = lerRazaoPlataforma(env);
  const { banco, migracoesDoCodigo: codigo, certificado: c } = fatos;
  const emDia = banco.ok && banco.aplicadas >= codigo.total && (banco.ultimaAplicada ?? 0) >= codigo.ultima;
  const diasDoCertificado = c.pronto ? Math.floor((c.validoAte.getTime() - fatos.agora.getTime()) / DIA) : null;
  const protocolo = fatos.protocolo?.split(",")[0].trim().toLowerCase() ?? null;

  return [
    {
      chave: "node-env",
      nome: "NODE_ENV",
      ok: emProducao,
      situacao: emProducao ? "production" : `${env.NODE_ENV || "não definido"} (não é produção)`,
      explicacao: [
        "Em produção tem de ser production: liga o cookie seguro e faz o login com Google ser obrigatório (o login desligado é ignorado).",
        "A imagem do docker/Dockerfile já define NODE_ENV=production. No servidor de desenvolvimento (npm run dev) ela é development, e por isso este item fica como Falta aqui.",
      ],
    },
    {
      chave: "login-desligado",
      nome: "Login desligado inativo",
      ok: !loginDesligado(env) && env.AUTH_DISABLED === undefined,
      situacao: loginDesligado(env)
        ? "Ligado: entra sem login como a conta de desenvolvimento"
        : env.AUTH_DISABLED !== undefined
          ? "AUTH_DISABLED definida (ignorada aqui, mas retire)"
          : "AUTH_DISABLED ausente",
      explicacao: [
        "AUTH_DISABLED=true abre o painel sem login, como a conta de desenvolvimento. Só vale fora de produção, mas em produção a variável não deve nem existir.",
        "No Coolify, não crie a variável AUTH_DISABLED (nem DEV_USER_EMAIL).",
      ],
    },
    {
      chave: "cookie-seguro",
      nome: "Cookie de sessão seguro",
      ok: emProducao,
      situacao: emProducao ? `${nomeDoCookie(true)}, Secure, httpOnly` : `${nomeDoCookie(false)}, sem Secure (desenvolvimento)`,
      explicacao: [
        "Em produção o cookie de sessão se chama __Host-sessao e vai com Secure: o navegador só o manda por HTTPS e não aceita que outro subdomínio o troque.",
        "Depende só de NODE_ENV=production. Sem HTTPS no domínio, o navegador recusa esse cookie e ninguém consegue entrar.",
      ],
    },
    {
      chave: "sessao-segredo",
      nome: "SESSAO_SEGREDO",
      ok: segredo.length >= TAMANHO_MINIMO_DO_SEGREDO,
      situacao: !segredo ? "Ausente" : segredo.length >= TAMANHO_MINIMO_DO_SEGREDO ? "Presente e válido" : `Presente, mas curto (mínimo ${TAMANHO_MINIMO_DO_SEGREDO} caracteres)`,
      explicacao: [
        "Assina o cookie de sessão. Sem ele (ou curto) o servidor não sobe.",
        "Gere com: openssl rand -base64 48. Trocar só desconecta todo mundo (cada um entra de novo).",
      ],
    },
    {
      chave: "token-chave",
      nome: "TOKEN_CHAVE",
      ok: token.ok,
      situacao: textoDaChave(token),
      explicacao: [
        "Cifra, no banco, o termo de autorização assinado e o token de cada empresa (AES-256-GCM).",
        `${GERAR_CHAVE}. Guarde uma cópia fora do servidor (gerenciador de senhas): sem ela, os termos guardados ficam ilegíveis e cada cliente assina de novo.`,
      ],
    },
    {
      chave: "plataforma-chave",
      nome: "PLATAFORMA_CHAVE",
      ok: plataforma.ok,
      situacao: textoDaChave(plataforma),
      explicacao: [
        "Cifra, no banco, o certificado e as chaves do contrato da plataforma. Tem de ser diferente da TOKEN_CHAVE.",
        `${GERAR_CHAVE}. Guarde uma cópia fora do servidor (gerenciador de senhas): sem ela, o certificado e as chaves guardados ficam ilegíveis e precisam ser enviados de novo.`,
      ],
    },
    {
      chave: "google-client-id",
      nome: "GOOGLE_CLIENT_ID",
      ok: Boolean(env.GOOGLE_CLIENT_ID?.trim()),
      situacao: env.GOOGLE_CLIENT_ID?.trim() ? "Definido" : "Ausente",
      explicacao: [
        "O Client ID (tipo Aplicativo da Web) do Google Cloud. Sem ele, a tela de entrada diz que o login com Google não está configurado.",
        "No Google Cloud, o domínio de produção com https:// tem de estar nas origens JavaScript autorizadas desse Client ID.",
      ],
    },
    {
      chave: "admin-emails",
      nome: "ADMIN_EMAILS",
      ok: admins.length > 0 && !comDev,
      situacao: admins.length === 0 ? "Vazio: ninguém é administrador" : comDev ? "Inclui a conta de desenvolvimento" : `${admins.length} ${admins.length === 1 ? "conta" : "contas"}, sem a de desenvolvimento`,
      explicacao: [
        "Quem é administrador da plataforma, separado por vírgula. Só as contas Google reais de quem administra.",
        `Em produção, sem a conta de desenvolvimento (${dev}), que só existe para o login desligado do computador local.`,
      ],
    },
    {
      chave: "banco",
      nome: "Banco de dados",
      ok: banco.ok,
      situacao: banco.ok ? "Responde" : "Não responde",
      explicacao: [
        "A conexão pela DATABASE_URL. No Coolify, use a URL interna do Postgres (Postgres URL (internal)), que só funciona dentro da rede do servidor.",
        "Sem banco, a rota /api/saude responde 503 e o Coolify marca a aplicação como fora do ar.",
      ],
    },
    {
      chave: "migracoes",
      nome: "Migrações",
      ok: emDia,
      situacao: !banco.ok ? "Sem banco, não dá para conferir" : emDia ? `Em dia (${banco.aplicadas} aplicadas)` : `${banco.aplicadas} de ${codigo.total} aplicadas`,
      explicacao: [
        "Compara as migrações aplicadas no banco com as que vêm no código (banco/migracoes).",
        "A imagem aplica as migrações sozinha ao subir (o CMD do docker/Dockerfile roda npm run banco:migrar antes de iniciar o site). Atrasadas: veja os registros do deploy no Coolify.",
      ],
    },
    {
      chave: "certificado",
      nome: "Certificado da plataforma",
      ok: c.pronto && c.origem === "banco" && (diasDoCertificado ?? 0) > DIAS_PARA_TROCAR_O_CERTIFICADO,
      situacao: c.pronto
        ? `${c.origem === "banco" ? "Guardado" : "Vem do ambiente (CERT_PFX_PATH)"} · válido até ${dataBr(c.validoAte)}${(diasDoCertificado ?? 0) <= DIAS_PARA_TROCAR_O_CERTIFICADO ? ` (vence em ${Math.max(diasDoCertificado ?? 0, 0)} dias)` : ""}`
        : c.vencidoEm
          ? `Vencido em ${dataBr(c.vencidoEm)}`
          : "Não está guardado",
      explicacao: [
        "O e-CNPJ A1 da plataforma, enviado em Certificado da plataforma (/admin/plataforma) e guardado cifrado com a PLATAFORMA_CHAVE. Em produção não use CERT_PFX_PATH.",
        `Fica como Falta também quando vence em ${DIAS_PARA_TROCAR_O_CERTIFICADO} dias ou menos.`,
        ...(c.pronto ? [] : [`Detalhe: ${c.motivo}`]),
      ],
    },
    {
      chave: "chaves",
      nome: "Chaves do contrato",
      ok: fatos.chaves === "guardadas",
      situacao:
        fatos.chaves === "guardadas" ? "Guardadas" : fatos.chaves === "ilegiveis" ? "Guardadas, mas não abrem com a PLATAFORMA_CHAVE atual" : fatos.chaves === "ambiente" ? "Vêm do ambiente" : "Não estão guardadas",
      explicacao: [
        "Consumer key e consumer secret do contrato da plataforma, enviados em Certificado da plataforma (/admin/plataforma) e guardados cifrados.",
        "Em produção não use as variáveis SERPRO_CONSUMER_KEY e SERPRO_CONSUMER_SECRET.",
      ],
    },
    {
      chave: "plataforma-cnpj",
      nome: "PLATAFORMA_CNPJ",
      ok: cnpj.cnpj !== null,
      situacao: cnpj.cnpj !== null ? "Definido e válido" : env.PLATAFORMA_CNPJ?.trim() ? "Inválido" : "Ausente",
      explicacao: ["O CNPJ da plataforma: contratante do contrato com a Receita e destinatário do termo que cada cliente assina."],
    },
    {
      chave: "plataforma-razao",
      nome: "PLATAFORMA_RAZAO_SOCIAL",
      ok: razao !== null,
      situacao: razao !== null ? "Definida" : "Ausente",
      explicacao: ["A razão social do PLATAFORMA_CNPJ, como a Receita mostra. Vai no termo de autorização como o nome do destinatário."],
    },
    {
      chave: "https",
      nome: "HTTPS nesta requisição",
      ok: protocolo === "https",
      situacao: protocolo ? `Chegou por ${protocolo}` : "Protocolo desconhecido",
      explicacao: [
        "Lido do cabeçalho x-forwarded-proto que o proxy do Coolify manda para a aplicação.",
        "Em produção tem de ser https: o domínio configurado com https:// no Coolify faz o certificado automático. Localmente (http://localhost) fica como Falta.",
      ],
    },
  ];
}
