// Cofre do navegador para a opção "Guardar neste navegador": a chave privada do e-CNPJ fica no IndexedDB como CryptoKey
// do WebCrypto NÃO EXPORTÁVEL (extractable: false, só "sign"): nem a página, nem a plataforma, nem quem abrir o
// IndexedDB consegue ler os bytes da chave; o navegador só deixa assinar com ela. Junto vão o certificado público (PEM),
// o CNPJ e as informações dele já lidas (validade, titular), para a tela conferir sem carregar o node-forge. A senha
// nunca é guardada. Um certificado por CNPJ (o usuário pode ter várias empresas): guardar de novo troca o anterior.
// Nada daqui vai para o servidor. Sem IndexedDB (navegação privada em alguns navegadores), a opção não fica disponível.
import type { InfoCertificado } from "@contabilizadev/nucleo/serpro/termo-xml";

export type CertificadoGuardado = {
  cnpj: string; // 14 dígitos: a chave do registro
  chave: CryptoKey; // privada, RSASSA-PKCS1-v1_5 com SHA-256, não exportável, só para assinar
  certificado: string; // PEM, a parte pública
  info: Omit<InfoCertificado, "certificadoBase64">;
  guardadoEm: Date;
};

export type Cofre = {
  disponivel: boolean;
  pegar(cnpj: string): Promise<CertificadoGuardado | null>;
  guardar(registro: CertificadoGuardado): Promise<void>;
  remover(cnpj: string): Promise<void>;
  cnpjs(): Promise<string[]>;
};

export const BANCO_DO_COFRE = "contabilizadev-assinador";
const LOJA = "certificados";
const VERSAO = 1;
export const SEM_COFRE = "Este navegador não permite guardar o certificado (navegação privada?). Use a opção Usar só agora.";

const pedido = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolver, rejeitar) => {
    r.onsuccess = () => resolver(r.result);
    r.onerror = () => rejeitar(r.error);
  });

function abrir(fabrica: IDBFactory): Promise<IDBDatabase> {
  const r = fabrica.open(BANCO_DO_COFRE, VERSAO);
  r.onupgradeneeded = () => {
    if (!r.result.objectStoreNames.contains(LOJA)) r.result.createObjectStore(LOJA, { keyPath: "cnpj" });
  };
  return pedido(r);
}

// Uma operação numa transação; o banco é fechado no fim (a tela usa o cofre poucas vezes).
async function naLoja<T>(fabrica: IDBFactory, modo: IDBTransactionMode, operacao: (loja: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const banco = await abrir(fabrica);
  try {
    const transacao = banco.transaction(LOJA, modo);
    const resultado = pedido(operacao(transacao.objectStore(LOJA)));
    await new Promise<void>((resolver, rejeitar) => {
      transacao.oncomplete = () => resolver();
      transacao.onerror = () => rejeitar(transacao.error);
      transacao.onabort = () => rejeitar(transacao.error);
    });
    return await resultado;
  } finally {
    banco.close();
  }
}

const cnpjValido = (cnpj: string) => /^\d{14}$/.test(cnpj);

// `fabrica`: o indexedDB do navegador (padrão) ou um falso nos testes.
export function cofreDoNavegador(fabrica: IDBFactory | undefined = typeof indexedDB === "undefined" ? undefined : indexedDB): Cofre {
  return {
    disponivel: Boolean(fabrica),
    async pegar(cnpj) {
      if (!fabrica || !cnpjValido(cnpj)) return null;
      const registro = await naLoja<CertificadoGuardado | undefined>(fabrica, "readonly", (l) => l.get(cnpj));
      // Só o que tem a forma esperada e a chave ainda não exportável.
      if (!registro || registro.cnpj !== cnpj || !(registro.chave instanceof CryptoKey) || registro.chave.extractable) return null;
      return registro;
    },
    async guardar(registro) {
      if (!fabrica) throw new Error(SEM_COFRE);
      if (!cnpjValido(registro.cnpj)) throw new Error("CNPJ inválido para guardar o certificado.");
      // A garantia de que ninguém copia a chave vem daqui: só entra chave privada não exportável e só para assinar.
      if (!(registro.chave instanceof CryptoKey) || registro.chave.extractable || registro.chave.type !== "private" || registro.chave.usages.join() !== "sign") {
        throw new Error("Só uma chave não exportável, só para assinar, pode ser guardada.");
      }
      await naLoja(fabrica, "readwrite", (l) => l.put(registro));
    },
    async remover(cnpj) {
      if (!fabrica) return;
      await naLoja(fabrica, "readwrite", (l) => l.delete(cnpj));
    },
    async cnpjs() {
      if (!fabrica) return [];
      return ((await naLoja(fabrica, "readonly", (l) => l.getAllKeys())) as IDBValidKey[]).map(String).sort();
    },
  };
}
