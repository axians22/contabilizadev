// Só para testes: XML de DCTFWeb no formato devolvido pelo Serpro (CONSXMLDECLARACAO38), com dados fictícios.
export function xmlDctf(o: { recibo?: string; saldo?: number[] } = {}) {
  const creditos = (o.saldo ?? [178.31])
    .map((v) => `<CreditoTributarioApurado><codReceita>109901</codReceita><ctValor>${v}</ctValor><saldoaPagar>${v}</saldoaPagar></CreditoTributarioApurado>`)
    .join("");
  return (
    `<ProcDctf xmlns="http://www.serpro.gov.br/dctf/v1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `<ConteudoDeclaracao id="id_123"><tns1:DctfXml xmlns:tns1="http://www.serpro.gov.br/dctf/v1" versao="3.0">` +
    `<A000-DadosIdentificadoresContribuinte><inscContrib>11222333000181</inscContrib><perApuracao>092026</perApuracao>` +
    `<indZerada>${creditos ? 0 : 1}</indZerada><A050-CreditosTributariosApurados>${creditos}</A050-CreditosTributariosApurados>` +
    `</A000-DadosIdentificadoresContribuinte></tns1:DctfXml></ConteudoDeclaracao>` +
    (o.recibo
      ? `<OutrasInformacoes><numeroRecibo>${o.recibo}</numeroRecibo><dataHoraTransmissao>20261005133010</dataHoraTransmissao></OutrasInformacoes>`
      : "") +
    `</ProcDctf>`
  );
}

// PDF mínimo com um stream FlateDecode e o texto dado (operadores Tj), como os da Receita.
import zlib from "node:zlib";
export function pdfComTexto(...linhas: string[]): Buffer {
  const conteudo = zlib.deflateSync(Buffer.from("BT " + linhas.map((l) => `(${l})Tj`).join(" ") + " ET", "latin1"));
  return Buffer.concat([Buffer.from("%PDF-1.4\n1 0 obj<<>>stream\n", "latin1"), conteudo, Buffer.from("\nendstream\nendobj", "latin1")]);
}
