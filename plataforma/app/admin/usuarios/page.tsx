import Link from "next/link";
import { Explicacao } from "@/app/explicacao";
import { Campo, Titulo, botaoLink } from "@/app/ui";
import { Tabela } from "@/app/tabela";
import { banco } from "@/banco";
import { configAutenticacao, exigirAreaDoAdmin } from "@/lib/autenticacao/servidor";
import { listarUsuarios, POR_PAGINA } from "@/lib/usuarios/servico";
import { mudarAtivoAcao, mudarPapelAcao } from "./acoes";
import { BotaoAcao } from "./botao-acao";

export const metadata = { title: "Usuários · ContabilizaDev" };

const PAPEL = { ADMIN: "Administrador", MANAGER: "Gestor", COMMON_USER: "Usuário" } as const;
const data = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—");

// Gestão de usuários (área do administrador): MANAGER vê e desativa usuários comuns; ADMIN também promove a gestor e
// rebaixa (as regras de quem altera quem ficam em lib/autenticacao/papeis.ts).
export default async function Usuarios({ searchParams }: { searchParams: Promise<{ q?: string; pagina?: string }> }) {
  const { usuario } = await exigirAreaDoAdmin("/admin/usuarios");
  const { q, pagina } = await searchParams;
  const lista = await listarUsuarios(banco(), usuario, typeof q === "string" ? q : "", Number(pagina) || 1, configAutenticacao().adminEmails);
  const link = (p: number) => `/admin/usuarios?${new URLSearchParams({ ...(q ? { q } : {}), pagina: String(p) })}`;

  return (
    <>
      <Titulo
        sobre="Administração"
        explicacao={
          <Explicacao
            rotulo="Como funcionam os papéis?"
            texto={["O papel de administrador vem da variável ADMIN_EMAILS (não se muda por aqui).", "Desativar uma conta derruba a sessão dela na hora."]}
          />
        }
      >
        Usuários
      </Titulo>
      <form className="flex flex-wrap items-end gap-3" role="search">
        <Campo rotulo="Buscar por nome ou e-mail" id="q" name="q" defaultValue={q ?? ""} type="search" />
        <button type="submit" className={botaoLink}>Buscar</button>
      </form>
      <Tabela
        rotulo="Usuários"
        porPagina={POR_PAGINA}
        vazio="Nenhum usuário encontrado."
        colunas={[
          { chave: "nome", titulo: "Nome", principal: true },
          { chave: "papel", titulo: "Papel" },
          { chave: "situacao", titulo: "Situação" },
          { chave: "ultimo", titulo: "Último login", ocultarNoCelular: true },
          { chave: "acoes", titulo: "Ações", alinhar: "direita" },
        ]}
        linhas={lista.itens.map((u) => ({
          chave: u.id,
          destaque: u.euMesmo,
          celulas: {
            nome: (
              <span className="flex flex-col">
                <span className="font-medium">{u.nome}{u.euMesmo && " (você)"}</span>
                <span className="text-xs text-muted">{u.email}</span>
              </span>
            ),
            papel: PAPEL[u.papel],
            situacao: u.ativo ? "Ativo" : `Desativado em ${data(u.desativadoEm)}${u.desativadoPor ? ` por ${u.desativadoPor}` : ""}`,
            ultimo: data(u.ultimoLoginEm),
            acoes: (
              <span className="inline-flex flex-wrap justify-end gap-1">
                {u.podeMudarPapel && (
                  <BotaoAcao acao={mudarPapelAcao} campos={{ usuarioId: u.id, papel: u.papel === "MANAGER" ? "COMMON_USER" : "MANAGER" }}>
                    {u.papel === "MANAGER" ? "Tirar de gestor" : "Tornar gestor"}
                  </BotaoAcao>
                )}
                {u.podeMudarAtivo && (
                  <BotaoAcao
                    acao={mudarAtivoAcao}
                    campos={{ usuarioId: u.id, ativo: String(!u.ativo) }}
                    confirmar={u.ativo ? `Desativar ${u.nome}? A sessão cai na hora.` : undefined}
                  >
                    {u.ativo ? "Desativar" : "Reativar"}
                  </BotaoAcao>
                )}
              </span>
            ),
          },
        }))}
      />
      {lista.paginas > 1 && (
        <nav className="flex items-center gap-3 text-sm" aria-label="Páginas">
          {lista.pagina > 1 && <Link className={botaoLink} href={link(lista.pagina - 1)}>Anterior</Link>}
          <span className="text-muted">
            Página {lista.pagina} de {lista.paginas} · {lista.total} usuários
          </span>
          {lista.pagina < lista.paginas && <Link className={botaoLink} href={link(lista.pagina + 1)}>Próxima</Link>}
        </nav>
      )}
    </>
  );
}
