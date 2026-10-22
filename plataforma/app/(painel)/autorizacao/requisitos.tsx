import { Explicacao } from "@/app/explicacao";

// Os dois requisitos para assinar o termo, cada um com o que é e onde conseguir no tooltip. O cliente marca que tem os
// dois para liberar a assinatura; quem não tem vê no tooltip o que fazer e continua no modo guiado. Sem estado: quem
// guarda o que foi marcado é a tela de assinatura (assinar-termo.tsx).
export const ITI_ACS = "https://www.gov.br/iti/pt-br/assuntos/icp-brasil/autoridades-certificadoras";
export const GOVBR_NIVEIS = "https://www.gov.br/governodigital/pt-br/identidade/conta-gov-br/niveis-da-conta-govbr";

export type Marcados = { certificado: boolean; govbr: boolean };

const caixa = "size-4 shrink-0 cursor-pointer accent-accent-ink";

// comprovacao: a empresa ainda aguarda comprovação (cadastro provisório): sem o termo não há modo guiado, o conteúdo fica
// fechado até a assinatura.
export function Requisitos({ marcados, marcar, comprovacao = false }: { marcados: Marcados; marcar: (m: Marcados) => void; comprovacao?: boolean }) {
  return (
    <fieldset className="flex flex-col gap-2 text-sm">
      <legend className="mb-1 font-medium">Antes de assinar, confirme que a empresa tem:</legend>
      <div className="flex items-center gap-2">
        <input id="req-certificado" type="checkbox" className={caixa} checked={marcados.certificado} onChange={(e) => marcar({ ...marcados, certificado: e.target.checked })} />
        <label htmlFor="req-certificado" className="cursor-pointer">
          Certificado digital e-CNPJ A1 da empresa (arquivo .pfx ou .p12)
        </label>
        <Explicacao
          rotulo="O que é o e-CNPJ A1 e onde conseguir?"
          titulo="Certificado digital e-CNPJ A1"
          texto={[
            "É a identidade digital da empresa, num arquivo (.pfx ou .p12) com senha. A empresa assina o termo com ele aqui no navegador: o arquivo e a senha não saem do seu computador.",
            "O A3 (token ou cartão) não serve: o navegador não consegue assinar com ele.",
            "Onde conseguir: numa Autoridade Certificadora credenciada pela ICP-Brasil (lista oficial do ITI abaixo). A emissão normalmente é por videoconferência e custa algumas centenas de reais por ano.",
          ]}
          link={{ href: ITI_ACS, texto: "Lista oficial das Autoridades Certificadoras" }}
        />
      </div>
      <div className="flex items-center gap-2">
        <input id="req-govbr" type="checkbox" className={caixa} checked={marcados.govbr} onChange={(e) => marcar({ ...marcados, govbr: e.target.checked })} />
        <label htmlFor="req-govbr" className="cursor-pointer">
          Conta gov.br nível prata ou ouro do responsável
        </label>
        <Explicacao
          rotulo="Para que serve a conta gov.br prata ou ouro?"
          titulo="Conta gov.br prata ou ouro"
          texto={[
            "É a conta de acesso aos serviços do governo. Os níveis prata e ouro são os que entram no e-CAC e nos portais da Receita Federal.",
            "Aqui, ela serve para entrar no e-CAC e nos portais quando algo precisar ser feito à mão, no modo guiado.",
            "Para subir o nível: no aplicativo gov.br, com reconhecimento facial, validação por um banco credenciado ou com o certificado digital.",
          ]}
          link={{ href: GOVBR_NIVEIS, texto: "Como subir o nível da conta gov.br" }}
        />
      </div>
      {!(marcados.certificado && marcados.govbr) && (
        <p className="text-muted">
          {comprovacao
            ? "Ainda não tem? Veja ao lado de cada item como conseguir; a empresa fica aguardando até você assinar."
            : "Ainda não tem? Veja ao lado de cada item como conseguir; enquanto isso, o modo guiado continua funcionando."}
        </p>
      )}
    </fieldset>
  );
}
