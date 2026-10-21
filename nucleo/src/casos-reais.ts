// Só para testes: documentos reais da empresa de referência, lidos do site pessoal (../fiscal, só leitura).
// Não são copiados para este projeto; sem a pasta, os testes que dependem deles são pulados.
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const PASTA = fileURLToPath(new URL("../../../fiscal/data/documentos/", import.meta.url));

export function documentoReal(nome: string): string | null {
  const caminho = PASTA + nome;
  return fs.existsSync(caminho) ? caminho : null;
}
