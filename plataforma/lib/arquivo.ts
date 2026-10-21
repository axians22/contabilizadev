// Regras do campo de envio de arquivo (app/campo-arquivo.tsx): o tipo pela extensão, o tamanho máximo e as mensagens
// em linguagem simples. Puro (roda no navegador e nos testes); o servidor confere de novo o que chega.

// Um e-CNPJ A1 (.pfx/.p12) tem poucos KB; 100 KB sobra e barra arquivo trocado (um PDF, uma foto).
export const TAMANHO_MAXIMO_PFX = 100 * 1024;
export const EXTENSOES_PFX = [".pfx", ".p12"] as const;
// O que o seletor do sistema mostra (a extensão decide; o tipo MIME do .pfx varia de sistema para sistema).
export const ACEITA_PFX = ".pfx,.p12,application/x-pkcs12";
// A frase da área de envio do .pfx (a mesma no assinador do navegador e na tela da plataforma).
export const CHAMADA_DO_PFX = "Arraste o arquivo .pfx aqui ou clique para escolher";

export type ArquivoEscolhido = { nome: string; tamanho: number };

// "1,5 KB", "820 bytes", "2,3 MB": o tamanho como a pessoa entende.
export function formatarTamanho(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const [valor, unidade] = bytes < 1024 * 1024 ? [bytes / 1024, "KB"] : [bytes / (1024 * 1024), "MB"];
  const casas = valor < 10 && !Number.isInteger(valor) ? 1 : 0;
  return `${valor.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: casas })} ${unidade}`;
}

// ".pfx ou .p12", ".pdf, .png ou .jpg".
export function listarExtensoes(extensoes: readonly string[]): string {
  if (extensoes.length <= 1) return extensoes[0] ?? "";
  return `${extensoes.slice(0, -1).join(", ")} ou ${extensoes.at(-1)}`;
}

const extensaoDe = (nome: string) => {
  const ponto = nome.lastIndexOf(".");
  return ponto <= 0 ? "" : nome.slice(ponto).toLowerCase();
};

// null = serve; senão, a mensagem para a tela (o que está errado e o que fazer).
export function conferirArquivo(arquivo: ArquivoEscolhido, regras: { extensoes: readonly string[]; tamanhoMaximo: number }): string | null {
  const tipos = listarExtensoes(regras.extensoes);
  if (!regras.extensoes.includes(extensaoDe(arquivo.nome))) return `“${arquivo.nome}” não é um arquivo ${tipos}. Escolha o arquivo certo.`;
  if (arquivo.tamanho === 0) return `“${arquivo.nome}” está vazio. Escolha o arquivo de novo.`;
  if (arquivo.tamanho > regras.tamanhoMaximo)
    return `“${arquivo.nome}” tem ${formatarTamanho(arquivo.tamanho)}, mais do que o limite de ${formatarTamanho(regras.tamanhoMaximo)}. Confira se é o arquivo certo.`;
  return null;
}
