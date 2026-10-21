import { Explicacao } from "@/app/explicacao";

// Pedaços da tela /admin/plataforma sem dados do servidor (os testes de tela desenham cada estado daqui). Sem
// certificado não é erro: é uma chamada clara para enviar. O motivo técnico (variáveis de ambiente, README) fica no
// tooltip, para quem quiser.

const chamada = "flex flex-wrap items-center gap-x-1 gap-y-1 rounded-xl border border-accent-ink/30 bg-accent/10 px-4 py-3 text-sm";

export function ChamadaDoCertificado({ motivo, doAmbiente }: { motivo?: string; doAmbiente: boolean }) {
  if (doAmbiente) {
    return (
      <p className={chamada}>
        <span className="font-semibold">Em uso o certificado do ambiente do servidor. Envie aqui para guardar na plataforma.</span>
        <Explicacao
          rotulo="De onde vem o certificado em uso?"
          texto={[
            "Sem certificado guardado aqui, vale o arquivo das variáveis CERT_PFX_PATH e CERT_PFX_SENHA do plataforma/.env.local.",
            "Enviado aqui, ele fica cifrado no banco e passa a valer no lugar do arquivo do ambiente (veja o README).",
          ]}
        />
      </p>
    );
  }
  return (
    <p className={chamada}>
      <span className="font-semibold">Envie o certificado da plataforma para ligar a integração.</span>
      <Explicacao
        rotulo="Por que a integração está desligada?"
        titulo="Detalhe técnico"
        texto={[
          ...(motivo ? [motivo] : []),
          "Sem o certificado, a plataforma não abre a conexão com a Receita Federal nem transmite ao eSocial. Ele também pode vir das variáveis CERT_PFX_PATH e CERT_PFX_SENHA do plataforma/.env.local (veja o README).",
        ]}
      />
    </p>
  );
}

// O certificado guardado não abre com a PLATAFORMA_CHAVE atual: aqui sim é um problema, mas a frase é curta.
export function CertificadoIlegivel({ quando }: { quando: string }) {
  return (
    <p role="alert" className="flex flex-wrap items-center gap-x-1 text-sm text-bad">
      <span>O certificado guardado não abre mais. Envie o e-CNPJ A1 de novo.</span>
      <Explicacao
        rotulo="Por que o certificado guardado não abre?"
        texto={`O certificado guardado em ${quando} foi cifrado com outra PLATAFORMA_CHAVE (a chave do plataforma/.env.local foi trocada). Enviar de novo cifra com a chave atual.`}
      />
    </p>
  );
}

// "Pronta" ou "Desligada" (sem vermelho: desligada é só falta de configuração), com o motivo no tooltip.
export function SituacaoDaIntegracao({ nome, pronto, motivo }: { nome: string; pronto: boolean; motivo?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium tracking-wide text-muted uppercase">{nome}</dt>
      <dd className="flex items-center gap-1 text-sm font-medium">
        {pronto ? (
          <span className="text-accent-ink">Pronta</span>
        ) : (
          <>
            <span className="text-warn">Desligada</span>
            {motivo && <Explicacao rotulo={`Por que ${nome} está desligada?`} titulo="Detalhe técnico" texto={motivo} />}
          </>
        )}
      </dd>
    </div>
  );
}
