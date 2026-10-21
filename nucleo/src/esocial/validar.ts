// Validação dos eventos contra os esquemas oficiais (nucleo/esquemas/esocial) antes de qualquer envio.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateXML } from "xmllint-wasm";

// A pasta dos esquemas, achada na hora (não como "new URL(pasta, import.meta.url)", que o empacotador do Next tenta
// embutir como arquivo e falha numa pasta): ao lado deste arquivo (testes, Node) ou a partir da pasta de trabalho do site
// (plataforma/ ou a raiz do projeto).
let pasta: string | undefined;
function pastaDosEsquemas(): string {
  if (pasta) return pasta;
  const candidatas = [
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "esquemas", "esocial"),
    path.join(process.cwd(), "..", "nucleo", "esquemas", "esocial"),
    path.join(process.cwd(), "nucleo", "esquemas", "esocial"),
  ];
  pasta = candidatas.find((c) => fs.existsSync(path.join(c, "tipos.xsd")));
  if (!pasta) throw new Error("Esquemas oficiais do eSocial não encontrados (nucleo/esquemas/esocial).");
  return pasta;
}
const arquivo = (nome: string) => ({ fileName: nome, contents: fs.readFileSync(path.join(pastaDosEsquemas(), nome), "utf8") });

export const ESQUEMAS = {
  evtInfoEmpregador: "evtInfoEmpregador.xsd",
  evtRemun: "evtRemun.xsd",
  evtPgtos: "evtPgtos.xsd",
  evtFechaEvPer: "evtFechaEvPer.xsd",
  evtReabreEvPer: "evtReabreEvPer.xsd",
  lote: "EnvioLoteEventos-v1_1_1.xsd",
} as const;
export type TipoEsquema = keyof typeof ESQUEMAS;

// Lista de erros (vazia quando o XML é válido).
export async function validar(xml: string, tipo: TipoEsquema): Promise<string[]> {
  const resultado = await validateXML({
    xml: { fileName: "evento.xml", contents: xml },
    schema: arquivo(ESQUEMAS[tipo]),
    preload: [arquivo("tipos.xsd"), arquivo("xmldsig-core-schema.xsd")],
  });
  return resultado.valid ? [] : resultado.errors.map((e) => e.message ?? e.rawMessage);
}
