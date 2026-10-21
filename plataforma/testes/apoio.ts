// Apoio dos testes de integração: configuração de login fixa e um verificador do Google falso.
import type { ConfigAutenticacao } from "@/lib/autenticacao/config";
import type { PerfilGoogle, VerificadorGoogle } from "@/lib/autenticacao/google";
import type { Dependencias } from "@/lib/autenticacao/servico";
import type { Banco } from "@/banco";

export const SEGREDO = "segredo-dos-testes-com-mais-de-32-caracteres";

export function configDeTeste(extra: Partial<ConfigAutenticacao> = {}): ConfigAutenticacao {
  return {
    segredo: SEGREDO,
    googleClientId: "cliente-de-teste.apps.googleusercontent.com",
    adminEmails: [],
    loginDesligado: false,
    emailDesenvolvimento: "dev@contabilizadev.local",
    producao: false,
    ...extra,
  };
}

// O "Google" dos testes: cada token é a chave de um perfil. Token desconhecido é recusado, como o Google faria
// com assinatura inválida ou audience de outro aplicativo.
export function googleFalso(perfis: Record<string, Partial<PerfilGoogle>>): VerificadorGoogle {
  return async (idToken) => {
    const p = perfis[idToken];
    if (!p) throw new Error("Wrong recipient, payload audience != requiredAudience");
    return { sub: undefined, email: undefined, emailVerificado: undefined, nome: undefined, foto: undefined, ...p };
  };
}

export const perfil = (email: string, sub: string, extra: Partial<PerfilGoogle> = {}): Partial<PerfilGoogle> => ({
  email,
  sub,
  emailVerificado: true,
  nome: email.split("@")[0],
  ...extra,
});

export function deps(banco: Banco, perfis: Record<string, Partial<PerfilGoogle>> = {}, config: Partial<ConfigAutenticacao> = {}, agora?: () => Date): Dependencias {
  return { banco, config: configDeTeste(config), verificarGoogle: googleFalso(perfis), agora };
}

// Banco que roda `acao` uma vez, logo antes de executar o primeiro insert em `tabela` (depois de montado, na hora do
// await). Serve para abrir a janela entre a leitura e a gravação e provar que a regra não depende dela.
export function antesDoInsert(banco: Banco, tabela: unknown, acao: () => PromiseLike<unknown>): Banco {
  let rodou = false;
  const embrulhar = (obj: object): object =>
    new Proxy(obj, {
      get(alvo, chave) {
        const valor = Reflect.get(alvo, chave, alvo);
        if (chave === "then" && typeof valor === "function") {
          return (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) => {
            const antes = rodou ? Promise.resolve() : ((rodou = true), Promise.resolve(acao()));
            return antes.then(() => valor.call(alvo, ok, falha), falha);
          };
        }
        if (typeof valor !== "function") return valor;
        return (...args: unknown[]) => {
          const r = valor.apply(alvo, args);
          return r && typeof r === "object" ? embrulhar(r) : r;
        };
      },
    });
  return new Proxy(banco, {
    get(alvo, chave) {
      const valor = Reflect.get(alvo, chave, alvo);
      if (chave === "insert") return (t: never) => (t === tabela ? embrulhar(alvo.insert(t)) : alvo.insert(t));
      return typeof valor === "function" ? valor.bind(alvo) : valor;
    },
  });
}
