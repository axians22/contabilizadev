// Eventos do eSocial do pró-labore, no leiaute S-1.3 (fontes: leiautes S-1.3 e MOS S-1.3; esquemas em nucleo/esquemas).
// Estrutura igual à que o contador enviava e foi aceita em produção (S-1200, S-1210 e S-1299); categoria, matrícula,
// lotação e rubricas são os cadastros do próprio cliente, recebidos por parâmetro. S-1298 (reabertura) e o S-1200
// retificador servem à retificação explícita do pró-labore de um mês já enviado.
import { soDigitos } from "../formato.ts";
import { centavos, inssProLabore, inssProLaboreDoMes } from "../simples.ts";
import { TP_AMB, type Ambiente } from "./ws.ts";

const NS = (evento: string) => `http://www.esocial.gov.br/schema/evt/${evento}/v_S_01_03_00`;
export const VER_PROC = "contabilizadev-1.0";
const valor = (n: number) => n.toFixed(2);

// Empregador pessoa jurídica: tpInsc 1 e o CNPJ raiz (8 dígitos) em nrInsc.
export type Empregador = { cnpj: string };
export const ideEmpregador = (e: Empregador) => {
  const cnpj = soDigitos(e.cnpj);
  if (cnpj.length !== 14) throw new Error("CNPJ do empregador inválido.");
  return `<ideEmpregador><tpInsc>1</tpInsc><nrInsc>${cnpj.slice(0, 8)}</nrInsc></ideEmpregador>`;
};

export type ParametrosFolha = {
  empregador: Empregador;
  cpf: string; // do sócio
  categoria: string; // ex.: 723 (sócio)
  matricula: string;
  lotacao: string;
  tabRubrica: string;
  rubricaProLabore: string;
  rubricaInss: string;
  qtdProLabore: string | null; // ex.: "220.00" (opcional no leiaute; vai como o cliente usa)
  proLabore: number;
};

// INSS de 11% do pró-labore; com a competência ("AAAA-MM"), limitado ao teto do ano.
export function valoresDoProLabore(proLabore: number, mes?: string) {
  const inss = mes ? inssProLaboreDoMes(mes, proLabore) : inssProLabore(proLabore);
  return { proLabore, inss, liquido: centavos(proLabore - inss) };
}

// Mesmo formato de ideDmDev usado pelo contador: MMAAAA + "MENSAL" + ddmmaaaahhmmss.
export function novoIdeDmDev(mes: string, quando = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  const [a, m] = mes.split("-");
  return `${m}${a}MENSAL${p(quando.getDate())}${p(quando.getMonth() + 1)}${quando.getFullYear()}${p(quando.getHours())}${p(quando.getMinutes())}${p(quando.getSeconds())}`;
}

// S-1000 de inclusão, só para o ambiente de testes (cadastrar a empresa lá e testar assinatura, lote e conexão).
export function s1000Teste(id: string, empregador: Empregador, iniValid: string) {
  return (
    `<eSocial xmlns="${NS("evtInfoEmpregador")}"><evtInfoEmpregador Id="${id}">` +
    `<ideEvento><tpAmb>${TP_AMB.restrita}</tpAmb><procEmi>1</procEmi><verProc>${VER_PROC}</verProc></ideEvento>${ideEmpregador(empregador)}` +
    `<infoEmpregador><inclusao><idePeriodo><iniValid>${iniValid}</iniValid></idePeriodo>` +
    `<infoCadastro><classTrib>01</classTrib><indCoop>0</indCoop><indConstr>0</indConstr><indDesFolha>0</indDesFolha><indOptRegEletron>0</indOptRegEletron></infoCadastro>` +
    `</inclusao></infoEmpregador></evtInfoEmpregador></eSocial>`
  );
}

// Retificação: indRetif 2 com o recibo do evento que está sendo corrigido.
export type Retificacao = { nrRecibo: string };
const indRetif = (r?: Retificacao) => (r ? `<indRetif>2</indRetif><nrRecibo>${r.nrRecibo}</nrRecibo>` : "<indRetif>1</indRetif>");

// S-1200: pró-labore do mês (rubrica de base) e INSS descontado (rubrica de desconto).
export function s1200(id: string, mes: string, ambiente: Ambiente, ideDmDev: string, p: ParametrosFolha, retificacao?: Retificacao) {
  const v = valoresDoProLabore(p.proLabore, mes);
  const qtd = p.qtdProLabore ? `<qtdRubr>${p.qtdProLabore}</qtdRubr>` : "";
  return (
    `<eSocial xmlns="${NS("evtRemun")}"><evtRemun Id="${id}">` +
    `<ideEvento>${indRetif(retificacao)}<indApuracao>1</indApuracao><perApur>${mes}</perApur>` +
    `<tpAmb>${TP_AMB[ambiente]}</tpAmb><procEmi>1</procEmi><verProc>${VER_PROC}</verProc></ideEvento>${ideEmpregador(p.empregador)}` +
    `<ideTrabalhador><cpfTrab>${soDigitos(p.cpf)}</cpfTrab></ideTrabalhador>` +
    `<dmDev><ideDmDev>${ideDmDev}</ideDmDev><codCateg>${p.categoria}</codCateg><infoPerApur><ideEstabLot>` +
    `<tpInsc>1</tpInsc><nrInsc>${soDigitos(p.empregador.cnpj)}</nrInsc><codLotacao>${p.lotacao}</codLotacao>` +
    `<remunPerApur><matricula>${p.matricula}</matricula>` +
    `<itensRemun><codRubr>${p.rubricaProLabore}</codRubr><ideTabRubr>${p.tabRubrica}</ideTabRubr>` +
    `${qtd}<vrRubr>${valor(v.proLabore)}</vrRubr><indApurIR>0</indApurIR></itensRemun>` +
    `<itensRemun><codRubr>${p.rubricaInss}</codRubr><ideTabRubr>${p.tabRubrica}</ideTabRubr>` +
    `<vrRubr>${valor(v.inss)}</vrRubr><indApurIR>0</indApurIR></itensRemun>` +
    `</remunPerApur></ideEstabLot></infoPerApur></dmDev></evtRemun></eSocial>`
  );
}

// S-1210: pagamento feito no mês `mes` do pró-labore da competência `perRef` (regime de caixa). O líquido é o do
// demonstrativo pago (o S-1200 de perRef); sem ele, o do pró-labore dos parâmetros.
export type Pagamento = { dtPgto: string; perRef: string; ideDmDev: string; liquido?: number };
export function s1210(id: string, mes: string, ambiente: Ambiente, pagamento: Pagamento, p: Pick<ParametrosFolha, "empregador" | "cpf" | "proLabore">) {
  const liquido = pagamento.liquido ?? valoresDoProLabore(p.proLabore, pagamento.perRef).liquido;
  return (
    `<eSocial xmlns="${NS("evtPgtos")}"><evtPgtos Id="${id}">` +
    `<ideEvento><indRetif>1</indRetif><perApur>${mes}</perApur>` +
    `<tpAmb>${TP_AMB[ambiente]}</tpAmb><procEmi>1</procEmi><verProc>${VER_PROC}</verProc></ideEvento>${ideEmpregador(p.empregador)}` +
    `<ideBenef><cpfBenef>${soDigitos(p.cpf)}</cpfBenef><infoPgto><dtPgto>${pagamento.dtPgto}</dtPgto><tpPgto>1</tpPgto>` +
    `<perRef>${pagamento.perRef}</perRef><ideDmDev>${pagamento.ideDmDev}</ideDmDev><vrLiq>${valor(liquido)}</vrLiq>` +
    `</infoPgto></ideBenef></evtPgtos></eSocial>`
  );
}

// S-1299: fecha o mês. Com transDCTFWeb, pede a transmissão imediata da DCTFWeb (opcional para quem não é do
// classTrib 04 nem informa indGuia, como as empresas do Simples; esquema evtFechaEvPer).
export function s1299(id: string, mes: string, ambiente: Ambiente, temPagamento: boolean, empregador: Empregador, transDCTFWeb = true) {
  return (
    `<eSocial xmlns="${NS("evtFechaEvPer")}"><evtFechaEvPer Id="${id}">` +
    `<ideEvento><indApuracao>1</indApuracao><perApur>${mes}</perApur>` +
    `<tpAmb>${TP_AMB[ambiente]}</tpAmb><procEmi>1</procEmi><verProc>${VER_PROC}</verProc></ideEvento>${ideEmpregador(empregador)}` +
    `<infoFech><evtRemun>S</evtRemun><evtPgtos>${temPagamento ? "S" : "N"}</evtPgtos><evtComProd>N</evtComProd>` +
    `<evtContratAvNP>N</evtContratAvNP><evtInfoComplPer>N</evtInfoComplPer>${transDCTFWeb ? "<transDCTFWeb>S</transDCTFWeb>" : ""}</infoFech>` +
    `</evtFechaEvPer></eSocial>`
  );
}

// S-1298: reabre o mês fechado, para retificar um evento dele (depois, um novo S-1299 fecha de novo).
export function s1298(id: string, mes: string, ambiente: Ambiente, empregador: Empregador) {
  return (
    `<eSocial xmlns="${NS("evtReabreEvPer")}"><evtReabreEvPer Id="${id}">` +
    `<ideEvento><indApuracao>1</indApuracao><perApur>${mes}</perApur>` +
    `<tpAmb>${TP_AMB[ambiente]}</tpAmb><procEmi>1</procEmi><verProc>${VER_PROC}</verProc></ideEvento>${ideEmpregador(empregador)}` +
    `</evtReabreEvPer></eSocial>`
  );
}
