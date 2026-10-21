import { formatarCnpj } from "@contabilizadev/nucleo/formato";
import { SISTEMA, TEXTO_AVISO_LEGAL, TEXTO_FINALIDADE, TEXTO_TERMO } from "@contabilizadev/nucleo/serpro/termo-autorizacao";

// Texto oficial do termo de autorização, por inteiro, como vai no documento assinado: o cliente precisa ler o que
// assina. É a ÚNICA exceção à regra de não mostrar o fornecedor (o texto oficial cita a API por trás); a exceção está
// no teste de textos visíveis (testes/sem-fornecedor-na-tela.test.ts) e vale só para este componente. É componente de
// servidor só para o bloco VISÍVEL ficar num lugar só (o da exceção testada). Os mesmos textos também vão para o
// navegador, num pedaço do código carregado sob demanda na hora de assinar (assinar-termo.tsx importa
// termo-autorizacao para o montarTermo, que precisa deles para montar o XML); lá não são texto visível.
// As datas (assinatura e vigência) ficam no resumo da tela de assinatura, que conhece a validade do certificado.
export function TextoOficial({ contratante, empresa }: { contratante: { numero: string; nome: string }; empresa: { cnpj: string; razaoSocial: string } }) {
  return (
    <section data-texto-oficial="" aria-label="Texto oficial do termo" className="flex flex-col gap-2 rounded-xl border border-line bg-raised px-4 py-3 text-sm leading-relaxed">
      <h3 className="font-semibold">Texto oficial do termo</h3>
      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        <div>
          <dt className="inline text-muted">Sistema: </dt>
          <dd className="inline">{SISTEMA}</dd>
        </div>
        <div>
          <dt className="inline text-muted">Destinatário (contratante): </dt>
          <dd className="inline">
            {contratante.nome} · CNPJ {formatarCnpj(contratante.numero)}
          </dd>
        </div>
        <div>
          <dt className="inline text-muted">Assinado por (autor pedido de dados): </dt>
          <dd className="inline">
            {empresa.razaoSocial} · CNPJ {formatarCnpj(empresa.cnpj)}
          </dd>
        </div>
      </dl>
      <h4 className="mt-1 font-medium">Termo</h4>
      <blockquote>{TEXTO_TERMO}</blockquote>
      <h4 className="mt-1 font-medium">Aviso legal</h4>
      <blockquote>{TEXTO_AVISO_LEGAL}</blockquote>
      <h4 className="mt-1 font-medium">Finalidade</h4>
      <blockquote>{TEXTO_FINALIDADE}</blockquote>
    </section>
  );
}
