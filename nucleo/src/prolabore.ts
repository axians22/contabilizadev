// Pró-labore do sócio em um mês, nesta ordem de preferência:
// 1. eSocial: S-1200 (bruto e INSS) e S-1210 (líquido e data do pagamento) baixados do eSocial;
// 2. Serpro (reserva): bruto calculado do DARF do INSS pago (o INSS do sócio é 11% do pró-labore);
// 3. Previsão pelo pró-labore configurado, para o mês corrente e os futuros.
import { centavos, inssProLaboreDoMes, tetoInss } from "./simples.ts";

export type Fonte = "esocial" | "serpro" | "previsto";
export type ProLabore = { mes: string; bruto: number; inss: number; liquido: number; pagoEm: string | null; fonte: Fonte; noTeto?: boolean };

// Evento do eSocial guardado (S-1200 = evtRemun, S-1210 = evtPgtos), do mais recente para o mais antigo.
export type EventoEsocial = { tipo: string; xml: string };
export type Rubricas = { proLabore: string; inss: string };

const campo = (xml: string, nome: string) => xml.match(new RegExp(`<${nome}>([^<]*)</${nome}>`))?.[1] ?? null;

// Pagamento do pró-labore de `mes`: S-1210 com perRef = mes (normalmente enviado no mês seguinte).
export function pagamentoDoMes(eventos: EventoEsocial[], mes: string): { liquido: number | null; pagoEm: string | null } | null {
  const info = eventos
    .filter((e) => e.tipo === "evtPgtos")
    .flatMap((e) => [...e.xml.matchAll(/<infoPgto>([\s\S]*?)<\/infoPgto>/g)].map((m) => m[1]))
    .find((i) => campo(i, "perRef") === mes);
  if (!info) return null;
  const liquido = campo(info, "vrLiq");
  return { liquido: liquido !== null ? Number(liquido) : null, pagoEm: campo(info, "dtPgto") };
}

// Lê o pró-labore do mês nos eventos (o mais recente vale, por causa de retificações).
export function proLaboreDoEsocial(eventos: EventoEsocial[], mes: string, rubricas: Rubricas): ProLabore | null {
  const remuneracao = eventos.find((e) => e.tipo === "evtRemun" && e.xml.includes(`<perApur>${mes}</perApur>`));
  if (!remuneracao) return null;
  const itens = [...remuneracao.xml.matchAll(/<itensRemun>([\s\S]*?)<\/itensRemun>/g)].map((m) => ({
    rubrica: campo(m[1], "codRubr"),
    valor: Number(campo(m[1], "vrRubr") ?? 0),
  }));
  const somar = (rubrica: string) => centavos(itens.filter((i) => i.rubrica === rubrica).reduce((s, i) => s + i.valor, 0));
  const bruto = somar(rubricas.proLabore);
  const inss = somar(rubricas.inss);
  if (bruto <= 0) return null;
  const pagamento = pagamentoDoMes(eventos, mes);
  return {
    mes,
    bruto,
    inss,
    liquido: pagamento?.liquido ?? centavos(bruto - inss),
    pagoEm: pagamento?.pagoEm ?? null,
    fonte: "esocial",
  };
}

// Reserva: bruto a partir do INSS pago no DARF (11%). Com o INSS no teto do ano, o pró-labore pode ser qualquer valor a
// partir do teto: o bruto devolvido é o teto (o mínimo garantido) e `noTeto` avisa que o valor real precisa ser informado.
export function proLaboreDoDarf(mes: string, inss: number, pagoEm: string | null = null): ProLabore {
  const teto = tetoInss(mes);
  const noTeto = inss >= centavos(teto * 0.11);
  const bruto = noTeto ? teto : centavos(inss / 0.11);
  return { mes, bruto, inss, liquido: centavos(bruto - inss), pagoEm, fonte: "serpro", ...(noTeto ? { noTeto } : {}) };
}

export function proLaborePrevisto(mes: string, bruto: number): ProLabore {
  const inss = inssProLaboreDoMes(mes, bruto);
  return { mes, bruto, inss, liquido: centavos(bruto - inss), pagoEm: null, fonte: "previsto" };
}
