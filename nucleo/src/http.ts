// POST HTTPS com certificado em memória (TLS mútuo), usado pelo Serpro e pelo eSocial.
// Os clientes recebem o transporte por parâmetro: nos testes ele é trocado por respostas gravadas.
import https from "node:https";

export type Certificado = { pfx: Buffer; senha: string };
// O mesmo certificado já aberto: a chave privada (PKCS#8) e o certificado com a cadeia, em PEM. É como a plataforma guarda
// o e-CNPJ dela no banco (cifrado), sem a senha; a conexão TLS aceita as duas formas.
export type CertificadoPem = { chave: string; certificado: string };
export type CertificadoTls = Certificado | CertificadoPem;
// Cabeçalhos com o nome em minúsculas (ex.: o Serpro manda no "etag" o tempo de espera de um pedido ainda em processamento).
export type RespostaHttp = { status: number; texto: string; cabecalhos?: Record<string, string> };
export type Transporte = (
  url: string,
  headers: Record<string, string>,
  corpo: string,
  certificado?: CertificadoTls,
) => Promise<RespostaHttp>;

export const opcoesTls = (c: CertificadoTls) => ("pfx" in c ? { pfx: c.pfx, passphrase: c.senha } : { key: c.chave, cert: c.certificado });

export function transporteHttps(timeoutMs = 60_000): Transporte {
  return (url, headers, corpo, certificado) =>
    new Promise((resolve, reject) => {
      const req = https.request(
        url,
        {
          method: "POST",
          headers: { ...headers, "Content-Length": String(Buffer.byteLength(corpo)) },
          timeout: timeoutMs,
          minVersion: "TLSv1.2",
          ...(certificado ? opcoesTls(certificado) : {}),
        },
        (res) => {
          const partes: Buffer[] = [];
          res.on("data", (p) => partes.push(p));
          res.on("end", () => {
            const cabecalhos: Record<string, string> = {};
            for (const [nome, valor] of Object.entries(res.headers)) {
              if (valor !== undefined) cabecalhos[nome.toLowerCase()] = Array.isArray(valor) ? valor.join(", ") : valor;
            }
            resolve({ status: res.statusCode ?? 0, texto: Buffer.concat(partes).toString("utf8"), cabecalhos });
          });
        },
      );
      req.on("timeout", () => req.destroy(new Error(`O servidor não respondeu em ${timeoutMs / 1000} segundos.`)));
      req.on("error", reject);
      req.end(corpo);
    });
}
