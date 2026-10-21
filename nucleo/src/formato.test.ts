import { test } from "node:test";
import assert from "node:assert/strict";
import { brl, cnpjValido, cpfValido, dataBr, formatarCnae, formatarCnpj, formatarCpf, formatarNatureza, isoDeCompacta, pct } from "./formato.ts";

test("formata dinheiro, porcentagem e data no padrão brasileiro", () => {
  assert.equal(brl(1000.76).replace(/\s/g, " "), "R$ 1.000,76");
  assert.equal(pct(0.0435), "4,35%");
  assert.equal(dataBr("2026-10-20"), "20/10/2026");
  assert.equal(isoDeCompacta("20261020"), "2026-10-20");
  assert.equal(dataBr(isoDeCompacta("20270101")), "01/01/2027");
});

test("brl: zero negativo e menos de meio centavo saem como R$ 0,00, sem sinal", () => {
  const z = (v: number) => brl(v).replace(/\s/g, " ");
  assert.equal(z(-0), "R$ 0,00");
  assert.equal(z(-0.004), "R$ 0,00");
  assert.equal(z(0.004), "R$ 0,00");
  assert.equal(z(-0.01), "-R$ 0,01");
  assert.equal(z(-1234.5), "-R$ 1.234,50");
});

test("formata e valida CNPJ e CPF", () => {
  assert.equal(formatarCnpj("11222333000181"), "11.222.333/0001-81");
  assert.equal(formatarCpf("52998224725"), "529.982.247-25");
  assert.equal(cnpjValido("11.222.333/0001-81"), true);
  assert.equal(cnpjValido("11.222.333/0001-82"), false);
  assert.equal(cnpjValido("00000000000000"), false);
  assert.equal(cnpjValido("1122233300018"), false);
  assert.equal(cpfValido("529.982.247-25"), true);
  assert.equal(cpfValido("529.982.247-24"), false);
  assert.equal(cpfValido("11111111111"), false);
});

test("CNPJ alfanumérico (IN RFB 2.229/2024): letras valem ASCII - 48 no cálculo dos dígitos verificadores", () => {
  // Exemplo oficial da Receita Federal.
  assert.equal(cnpjValido("12ABC34501DE35"), true);
  assert.equal(cnpjValido("12.abc.345/01de-35"), true);
  assert.equal(cnpjValido("12ABC34501DE36"), false);
  // Dígito verificador é sempre número; caracteres fora de A-Z/0-9 não valem.
  assert.equal(cnpjValido("12ABC34501DEA5"), false);
  assert.equal(cnpjValido("12ABC34501D!35"), false);
  assert.equal(cnpjValido("AAAAAAAAAAAAAA"), false);
  // O numérico continua igual.
  assert.equal(cnpjValido("00.000.000/0001-91"), true);
});

test("formata CNAE e natureza jurídica", () => {
  assert.equal(formatarCnae("6201501"), "6201-5/01");
  assert.equal(formatarCnae("7490104"), "7490-1/04");
  assert.equal(formatarCnae("6201-5/01"), "6201-5/01");
  // Fora do tamanho esperado volta só com os dígitos, sem inventar pontuação.
  assert.equal(formatarCnae("620150"), "620150");
  assert.equal(formatarNatureza("2062"), "206-2");
  assert.equal(formatarNatureza("206-2"), "206-2");
  assert.equal(formatarNatureza("20622"), "20622");
});
