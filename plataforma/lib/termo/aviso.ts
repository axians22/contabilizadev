// O sino e o painel avisam quando faltam estes dias ou menos para o termo vencer (situacao.ts decide o aviso).
// Fica sozinho, sem nenhum import, para a tela de assinatura (componente do navegador) poder usar o mesmo número sem
// levar junto situacao.ts, que importa termo-autorizacao (node-forge e os textos), carregado só sob demanda.
export const AVISO_DIAS = 30;
