// Calendário de dias sem expediente bancário em todo o país, para vencimentos ("AAAA-MM-DD").
// Dia não útil = sábado, domingo ou feriado nacional (Resolução CMN 4.880/2020, art. 2º), mais os dias em que os
// bancos não abrem no país todo pelo calendário da Febraban: segunda e terça de Carnaval, Sexta-feira da Paixão e
// Corpus Christi. Feriados nacionais fixos: Lei 662/1949 (com a redação da Lei 10.607/2002), Lei 6.802/1980
// (12/10) e Lei 14.759/2023 (20/11, a partir de 2024). Os móveis são calculados pela Páscoa.
// Feriados estaduais ou municipais (ou um ponto facultativo bancário novo) entram pelo parâmetro `extras`.

export const FONTE_FERIADOS =
  "Resolução CMN 4.880/2020; Leis 662/1949, 10.607/2002, 6.802/1980 e 14.759/2023; calendário Febraban (Carnaval, Paixão, Corpus Christi)";

const FIXOS: { dia: string; nome: string; desde?: number }[] = [
  { dia: "01-01", nome: "Confraternização Universal" },
  { dia: "04-21", nome: "Tiradentes" },
  { dia: "05-01", nome: "Dia do Trabalho" },
  { dia: "09-07", nome: "Independência do Brasil" },
  { dia: "10-12", nome: "Nossa Senhora Aparecida" },
  { dia: "11-02", nome: "Finados" },
  { dia: "11-15", nome: "Proclamação da República" },
  { dia: "11-20", nome: "Dia Nacional de Zumbi e da Consciência Negra", desde: 2024 },
  { dia: "12-25", nome: "Natal" },
];

// Datas em UTC para não depender do fuso nem do horário de verão.
const paraUtc = (data: string) => {
  const [a, m, d] = data.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d));
};
const iso = (d: Date) => d.toISOString().slice(0, 10);
export const somarDias = (data: string, n: number) => {
  const d = paraUtc(data);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};

// Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano).
export function pascoa(ano: number): string {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

export type Feriado = { data: string; nome: string };

// Feriados bancários nacionais do ano, em ordem de data.
export function feriadosNacionais(ano: number): Feriado[] {
  const p = pascoa(ano);
  const moveis: Feriado[] = [
    { data: somarDias(p, -48), nome: "Carnaval (segunda-feira)" },
    { data: somarDias(p, -47), nome: "Carnaval (terça-feira)" },
    { data: somarDias(p, -2), nome: "Sexta-feira da Paixão" },
    { data: somarDias(p, 60), nome: "Corpus Christi" },
  ];
  const fixos = FIXOS.filter((f) => !f.desde || ano >= f.desde).map((f) => ({ data: `${ano}-${f.dia}`, nome: f.nome }));
  return [...fixos, ...moveis].sort((x, y) => x.data.localeCompare(y.data));
}

// Dia com expediente bancário. `extras` = feriados locais ou outros dias sem expediente ("AAAA-MM-DD").
export function diaUtil(data: string, extras: string[] = []): boolean {
  if ([0, 6].includes(paraUtc(data).getUTCDay())) return false;
  if (extras.includes(data)) return false;
  return !feriadosNacionais(Number(data.slice(0, 4))).some((f) => f.data === data);
}

// A própria data, se for dia útil, ou o dia útil imediatamente anterior.
export function diaUtilAnterior(data: string, extras: string[] = []): string {
  let d = data;
  while (!diaUtil(d, extras)) d = somarDias(d, -1);
  return d;
}

// A própria data, se for dia útil, ou o próximo dia útil.
export function diaUtilSeguinte(data: string, extras: string[] = []): string {
  let d = data;
  while (!diaUtil(d, extras)) d = somarDias(d, 1);
  return d;
}
